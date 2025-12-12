#include "disk_stressor.h"
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <cstring>
#include <cstdlib>
#include <dirent.h>
#include <android/log.h>

#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, "DANR-DiskStressor", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "DANR-DiskStressor", __VA_ARGS__)

namespace danr {

DiskStressor::~DiskStressor() {
    stop();
}

void DiskStressor::setConfig(const DiskStressConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_ = config;
}

bool DiskStressor::start() {
    return start(config_);
}

bool DiskStressor::start(const DiskStressConfig& config) {
    if (isRunning()) {
        LOGD("Disk stress test already running");
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        config_ = config;
    }

    if (!ensureDirectory(config.testPath)) {
        LOGE("Failed to create test directory: %s", config.testPath.c_str());
        return false;
    }

    setDuration(config.durationMs);
    markStarted();
    bytesWritten_.store(0);
    bytesRead_.store(0);

    LOGD("Starting disk stress: %d MB/s throughput, %d KB chunks for %ld ms",
         config.throughputMBps, config.chunkSizeKB, config.durationMs);

    workerThread_ = std::thread(&DiskStressor::workerFunction, this);
    return true;
}

void DiskStressor::stop() {
    bool wasRunning = isRunning();

    if (wasRunning) {
        LOGD("Stopping disk stress test");
        markStopped();
    }

    // Always try to join and cleanup, even if already stopped
    // (handles case where duration expired naturally)
    if (workerThread_.joinable()) {
        workerThread_.join();
    }

    cleanup();

    if (wasRunning) {
        LOGD("Disk stress test stopped");
    }
}

void DiskStressor::workerFunction() {
    int throughputMBps;
    int chunkSizeKB;
    std::string testPath;
    bool useDirectIO;
    bool syncWrites;
    long endTime;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        throughputMBps = config_.throughputMBps;
        chunkSizeKB = config_.chunkSizeKB;
        testPath = config_.testPath;
        useDirectIO = config_.useDirectIO;
        syncWrites = config_.syncWrites;
        endTime = startTimeMs_.load() + durationMs_.load();
    }

    const size_t chunkSize = static_cast<size_t>(chunkSizeKB) * 1024;
    const long targetBytesPerSecond = static_cast<long>(throughputMBps) * 1024 * 1024;

    // Allocate aligned buffer for O_DIRECT
    void* alignedBuffer = nullptr;
    char* buffer = nullptr;

    if (useDirectIO) {
        if (posix_memalign(&alignedBuffer, 4096, chunkSize) != 0) {
            LOGE("Failed to allocate aligned buffer, falling back to regular allocation");
            buffer = new char[chunkSize];
        } else {
            buffer = static_cast<char*>(alignedBuffer);
        }
    } else {
        buffer = new char[chunkSize];
    }

    // Fill buffer with random data
    for (size_t i = 0; i < chunkSize; i++) {
        buffer[i] = static_cast<char>(rand() % 256);
    }

    int fileCounter = 0;
    long cycleStartTime = getCurrentTimeMs();
    long bytesThisCycle = 0;

    while (running_.load() && getCurrentTimeMs() < endTime) {
        std::string filePath = testPath + "/stress_" + std::to_string(fileCounter++) + ".tmp";

        // Open file for writing
        int flags = O_WRONLY | O_CREAT | O_TRUNC;
        if (useDirectIO) {
            flags |= O_DIRECT;
        }

        int fd = open(filePath.c_str(), flags, 0644);
        if (fd < 0) {
            LOGE("Failed to open file for writing: %s", filePath.c_str());
            usleep(10000);
            continue;
        }

        // Write data
        ssize_t written = write(fd, buffer, chunkSize);
        if (written > 0) {
            bytesWritten_.fetch_add(written);
            bytesThisCycle += written;
        }

        if (syncWrites) {
            fsync(fd);
        }

        close(fd);

        // Read data back
        flags = O_RDONLY;
        if (useDirectIO) {
            flags |= O_DIRECT;
        }

        fd = open(filePath.c_str(), flags);
        if (fd >= 0) {
            ssize_t readBytes = read(fd, buffer, chunkSize);
            if (readBytes > 0) {
                bytesRead_.fetch_add(readBytes);
                bytesThisCycle += readBytes;
            }
            close(fd);
        }

        // Delete the file
        unlink(filePath.c_str());

        // Throttle to achieve target throughput
        long elapsed = getCurrentTimeMs() - cycleStartTime;
        if (elapsed > 0) {
            long expectedBytes = (targetBytesPerSecond * elapsed) / 1000;
            if (bytesThisCycle > expectedBytes) {
                long sleepMs = ((bytesThisCycle - expectedBytes) * 1000) / targetBytesPerSecond;
                if (sleepMs > 0 && sleepMs < 1000) {
                    usleep(sleepMs * 1000);
                }
            }
        }

        // Reset cycle counters every second
        if (elapsed >= 1000) {
            cycleStartTime = getCurrentTimeMs();
            bytesThisCycle = 0;
        }
    }

    // Cleanup buffer
    if (alignedBuffer) {
        free(alignedBuffer);
    } else {
        delete[] buffer;
    }

    // Mark as stopped when duration expires naturally
    markStopped();

    // Clean up temp files
    cleanup();

    LOGD("Disk stress worker completed");
}

void DiskStressor::cleanup() {
    std::string testPath;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        testPath = config_.testPath;
    }

    // Remove all temp files in the test directory
    DIR* dir = opendir(testPath.c_str());
    if (dir) {
        struct dirent* entry;
        while ((entry = readdir(dir)) != nullptr) {
            if (strstr(entry->d_name, "stress_") && strstr(entry->d_name, ".tmp")) {
                std::string filePath = testPath + "/" + entry->d_name;
                unlink(filePath.c_str());
            }
        }
        closedir(dir);
    }

    LOGD("Cleaned up temp files");
}

bool DiskStressor::ensureDirectory(const std::string& path) {
    struct stat st;
    if (stat(path.c_str(), &st) == 0) {
        return S_ISDIR(st.st_mode);
    }

    return mkdir(path.c_str(), 0755) == 0;
}

StressStatus DiskStressor::getStatus() const {
    StressStatus status;
    status.type = "disk_io";
    status.isRunning = isRunning();
    status.remainingTimeMs = getRemainingTimeMs();

    if (status.isRunning) {
        std::lock_guard<std::mutex> lock(mutex_);
        status.data["bytesWrittenMB"] = std::to_string(bytesWritten_.load() / (1024 * 1024));
        status.data["bytesReadMB"] = std::to_string(bytesRead_.load() / (1024 * 1024));
        status.data["throughputMBps"] = std::to_string(config_.throughputMBps);
    }

    return status;
}

} // namespace danr
