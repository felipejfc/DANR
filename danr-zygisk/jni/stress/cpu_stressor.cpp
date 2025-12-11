#include "cpu_stressor.h"
#include <cmath>
#include <unistd.h>
#include <sched.h>
#include <android/log.h>

#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, "DANR-CPUStressor", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "DANR-CPUStressor", __VA_ARGS__)

namespace danr {

CPUStressor::~CPUStressor() {
    stop();
}

void CPUStressor::setConfig(const CPUStressConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_ = config;
}

bool CPUStressor::start() {
    return start(config_);
}

bool CPUStressor::start(const CPUStressConfig& config) {
    if (isRunning()) {
        LOGD("CPU stress test already running");
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        config_ = config;
    }

    setDuration(config.durationMs);
    markStarted();
    totalOpsCompleted_.store(0);

    LOGD("Starting CPU stress: %d threads at %d%% for %ld ms",
         config.threadCount, config.loadPercentage, config.durationMs);

    int numCores = getNumCores();
    workerThreads_.clear();

    for (int i = 0; i < config.threadCount; i++) {
        int coreId = -1;
        if (config.pinToCores && !config.targetCores.empty()) {
            coreId = config.targetCores[i % config.targetCores.size()];
        } else if (config.pinToCores) {
            coreId = i % numCores;
        }

        workerThreads_.emplace_back(&CPUStressor::workerFunction, this, i, coreId);
    }

    return true;
}

void CPUStressor::stop() {
    bool wasRunning = isRunning();

    if (wasRunning) {
        LOGD("Stopping CPU stress test");
        markStopped();
    }

    // Always try to join, even if already stopped
    // (handles case where duration expired naturally)
    for (auto& thread : workerThreads_) {
        if (thread.joinable()) {
            thread.join();
        }
    }
    workerThreads_.clear();

    if (wasRunning) {
        LOGD("CPU stress test stopped");
    }
}

void CPUStressor::workerFunction(int threadId, int coreId) {
    if (coreId >= 0) {
        if (pinThreadToCore(coreId)) {
            LOGD("Thread %d pinned to core %d", threadId, coreId);
        } else {
            LOGD("Failed to pin thread %d to core %d", threadId, coreId);
        }
    }

    int loadPercentage;
    long endTime;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        loadPercentage = config_.loadPercentage;
        endTime = startTimeMs_.load() + durationMs_.load();
    }

    const int workMs = 10;
    const int sleepMs = loadPercentage < 100
        ? ((100 - loadPercentage) * workMs) / std::max(loadPercentage, 1)
        : 0;

    while (running_.load() && getCurrentTimeMs() < endTime) {
        // CPU-intensive work using math operations
        long workEndTime = getCurrentTimeMs() + workMs;
        double result = 0.0;

        while (getCurrentTimeMs() < workEndTime && running_.load()) {
            for (int i = 0; i < 1000; i++) {
                result += std::sqrt(static_cast<double>(i))
                        + std::sin(static_cast<double>(i))
                        + std::cos(static_cast<double>(i));
            }
            totalOpsCompleted_.fetch_add(1000);
        }

        // Sleep to achieve target load percentage
        if (sleepMs > 0 && running_.load()) {
            usleep(sleepMs * 1000);
        }
    }

    // Mark as stopped when duration expires (safe to call from multiple threads - atomic)
    markStopped();
    LOGD("CPU stress thread %d completed", threadId);
}

int CPUStressor::getNumCores() const {
    int cores = sysconf(_SC_NPROCESSORS_ONLN);
    return cores > 0 ? cores : 4;
}

bool CPUStressor::pinThreadToCore(int coreId) {
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(coreId, &cpuset);
    return sched_setaffinity(0, sizeof(cpuset), &cpuset) == 0;
}

StressStatus CPUStressor::getStatus() const {
    StressStatus status;
    status.type = "cpu";
    status.isRunning = isRunning();
    status.remainingTimeMs = getRemainingTimeMs();

    if (status.isRunning) {
        std::lock_guard<std::mutex> lock(mutex_);
        status.data["threadCount"] = std::to_string(config_.threadCount);
        status.data["loadPercentage"] = std::to_string(config_.loadPercentage);
        status.data["opsCompleted"] = std::to_string(totalOpsCompleted_.load());
    }

    return status;
}

} // namespace danr
