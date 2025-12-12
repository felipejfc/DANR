#include "memory_stressor.h"
#include <fstream>
#include <sstream>
#include <cstring>
#include <unistd.h>
#include <sys/mman.h>
#include <android/log.h>

#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, "DANR-MemoryStressor", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "DANR-MemoryStressor", __VA_ARGS__)

namespace danr {

MemoryStressor::~MemoryStressor() {
    stop();
}

void MemoryStressor::setConfig(const MemoryStressConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_ = config;
}

bool MemoryStressor::start() {
    return start(config_);
}

bool MemoryStressor::start(const MemoryStressConfig& config) {
    if (isRunning()) {
        LOGD("Memory stress test already running");
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        config_ = config;
    }

    setDuration(config.durationMs);
    markStarted();
    allocatedBytes_.store(0);

    LOGD("Starting memory stress: target %d MB free, chunk size %d MB for %ld ms",
         config.targetFreeMB, config.chunkSizeMB, config.durationMs);

    workerThread_ = std::thread(&MemoryStressor::workerFunction, this);
    return true;
}

void MemoryStressor::stop() {
    bool wasRunning = isRunning();

    if (wasRunning) {
        LOGD("Stopping memory stress test");
        markStopped();
    }

    // Always try to join and cleanup, even if already stopped
    // (handles case where duration expired naturally)
    if (workerThread_.joinable()) {
        workerThread_.join();
    }

    releaseMemory();

    if (wasRunning) {
        LOGD("Memory stress test stopped");
    }
}

void MemoryStressor::workerFunction() {
    int targetFreeMB;
    int chunkSizeMB;
    bool lockMemory;
    long endTime;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        targetFreeMB = config_.targetFreeMB;
        chunkSizeMB = config_.chunkSizeMB;
        lockMemory = config_.lockMemory;
        endTime = startTimeMs_.load() + durationMs_.load();
    }

    const size_t chunkSize = static_cast<size_t>(chunkSizeMB) * 1024 * 1024;

    // Phase 1: Allocate memory until target free memory is reached
    LOGD("Phase 1: Allocating memory to reach target %d MB free", targetFreeMB);

    while (running_.load() && getCurrentTimeMs() < endTime) {
        long availableMB = getAvailableMemoryMB();

        if (availableMB <= targetFreeMB) {
            // Target reached, maintain pressure
            break;
        }

        void* ptr = allocateChunk(chunkSize);
        if (ptr == nullptr) {
            LOGE("Failed to allocate memory chunk");
            usleep(100000); // Wait 100ms before retry
            continue;
        }

        // Touch the memory to ensure it's actually allocated
        memset(ptr, 0xAA, chunkSize);

        if (lockMemory) {
            if (mlock(ptr, chunkSize) != 0) {
                LOGD("mlock failed (may need root)");
            }
        }

        {
            std::lock_guard<std::mutex> lock(mutex_);
            allocations_.push_back(ptr);
        }
        allocatedBytes_.fetch_add(chunkSize);

        LOGD("Allocated %d MB chunk, total: %ld MB, available: %ld MB",
             chunkSizeMB, allocatedBytes_.load() / (1024 * 1024), availableMB);
    }

    // Phase 2: Maintain memory pressure
    LOGD("Phase 2: Maintaining memory pressure");

    while (running_.load() && getCurrentTimeMs() < endTime) {
        long availableMB = getAvailableMemoryMB();

        // If free memory increased significantly, allocate more
        if (availableMB > targetFreeMB + chunkSizeMB) {
            void* ptr = allocateChunk(chunkSize);
            if (ptr != nullptr) {
                memset(ptr, 0xAA, chunkSize);
                if (lockMemory) {
                    mlock(ptr, chunkSize);
                }
                {
                    std::lock_guard<std::mutex> lock(mutex_);
                    allocations_.push_back(ptr);
                }
                allocatedBytes_.fetch_add(chunkSize);
            }
        }

        usleep(500000); // Check every 500ms
    }

    // Mark as stopped when duration expires naturally
    markStopped();

    // Release memory when test completes
    releaseMemory();

    LOGD("Memory stress worker completed");
}

void MemoryStressor::releaseMemory() {
    std::vector<void*> toFree;
    size_t chunkSize;
    bool useMmap;
    bool lockMemory;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        chunkSize = static_cast<size_t>(config_.chunkSizeMB) * 1024 * 1024;
        useMmap = config_.useAnonymousMmap;
        lockMemory = config_.lockMemory;
        toFree = std::move(allocations_);
        allocations_.clear();
        allocatedBytes_.store(0);
    }

    // Free memory outside the lock to avoid deadlock
    for (void* ptr : toFree) {
        if (lockMemory) {
            munlock(ptr, chunkSize);
        }
        if (useMmap) {
            munmap(ptr, chunkSize);
        } else {
            free(ptr);
        }
    }

    LOGD("Released all allocated memory (%zu chunks)", toFree.size());
}

long MemoryStressor::getAvailableMemoryMB() const {
    std::ifstream meminfo("/proc/meminfo");
    if (!meminfo.is_open()) {
        return -1;
    }

    std::string line;
    long availableKB = 0;

    while (std::getline(meminfo, line)) {
        if (line.find("MemAvailable:") == 0) {
            std::istringstream iss(line);
            std::string key;
            iss >> key >> availableKB;
            break;
        }
    }

    return availableKB / 1024;
}

void* MemoryStressor::allocateChunk(size_t size) {
    bool useMmap;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        useMmap = config_.useAnonymousMmap;
    }

    if (useMmap) {
        void* ptr = mmap(nullptr, size, PROT_READ | PROT_WRITE,
                         MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
        if (ptr == MAP_FAILED) {
            return nullptr;
        }
        return ptr;
    } else {
        return malloc(size);
    }
}

void MemoryStressor::freeChunk(void* ptr, size_t size) {
    bool useMmap;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        useMmap = config_.useAnonymousMmap;
    }

    if (useMmap) {
        munmap(ptr, size);
    } else {
        free(ptr);
    }
}

StressStatus MemoryStressor::getStatus() const {
    StressStatus status;
    status.type = "memory";
    status.isRunning = isRunning();
    status.remainingTimeMs = getRemainingTimeMs();

    if (status.isRunning) {
        std::lock_guard<std::mutex> lock(mutex_);
        status.data["allocatedMB"] = std::to_string(allocatedBytes_.load() / (1024 * 1024));
        status.data["targetFreeMB"] = std::to_string(config_.targetFreeMB);
        status.data["availableMB"] = std::to_string(getAvailableMemoryMB());
    }

    return status;
}

} // namespace danr
