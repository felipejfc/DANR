#include "thermal_stressor.h"
#include <fstream>
#include <sstream>
#include <unistd.h>
#include <dirent.h>
#include <android/log.h>

#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, "DANR-ThermalStressor", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "DANR-ThermalStressor", __VA_ARGS__)

namespace danr {

ThermalStressor::~ThermalStressor() {
    stop();
}

void ThermalStressor::setConfig(const ThermalStressConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_ = config;
}

bool ThermalStressor::start() {
    return start(config_);
}

bool ThermalStressor::start(const ThermalStressConfig& config) {
    if (isRunning()) {
        LOGD("Thermal stress test already running");
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        config_ = config;
        originalSettings_.clear();
    }

    totalCores_.store(getNumCores());
    setDuration(config.durationMs);
    markStarted();

    LOGD("Starting thermal stress: maxFreq=%d%%, forceAllCores=%s for %ld ms",
         config.maxFrequencyPercent,
         config.forceAllCoresOnline ? "true" : "false",
         config.durationMs);

    workerThread_ = std::thread(&ThermalStressor::workerFunction, this);
    return true;
}

void ThermalStressor::stop() {
    bool wasRunning = isRunning();

    if (wasRunning) {
        LOGD("Stopping thermal stress test");
        markStopped();
    }

    // Always try to join and cleanup, even if already stopped
    // (handles case where duration expired naturally)
    if (workerThread_.joinable()) {
        workerThread_.join();
    }

    restoreSettings();

    if (wasRunning) {
        LOGD("Thermal stress test stopped");
    }
}

void ThermalStressor::workerFunction() {
    long endTime;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        endTime = startTimeMs_.load() + durationMs_.load();
    }

    // Apply CPU settings
    applySettings();

    // Monitor and maintain settings for duration
    while (running_.load() && getCurrentTimeMs() < endTime) {
        // Re-apply settings periodically in case system changes them
        int online = 0;
        int total = totalCores_.load();

        for (int cpu = 0; cpu < total; cpu++) {
            if (isCoreOnline(cpu)) {
                online++;
            }
        }
        coresOnline_.store(online);

        // If cores went offline and we want them online, re-enable
        bool forceAllCores;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            forceAllCores = config_.forceAllCoresOnline;
        }

        if (forceAllCores && online < total) {
            for (int cpu = 1; cpu < total; cpu++) {  // Skip CPU0
                if (!isCoreOnline(cpu)) {
                    setCoreOnline(cpu, true);
                }
            }
        }

        usleep(1000000); // Check every second
    }

    // Mark as stopped when duration expires naturally
    markStopped();
    LOGD("Thermal stress worker completed");
}

void ThermalStressor::applySettings() {
    int numCores = totalCores_.load();
    bool forceAllCores;
    int maxFreqPercent;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        forceAllCores = config_.forceAllCoresOnline;
        maxFreqPercent = config_.maxFrequencyPercent;
    }

    // Force all cores online
    if (forceAllCores) {
        for (int cpu = 1; cpu < numCores; cpu++) {  // CPU0 is always online
            std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) + "/online";
            std::string original = readSysFile(path);
            if (!original.empty()) {
                std::lock_guard<std::mutex> lock(mutex_);
                originalSettings_[path] = original;
            }
            setCoreOnline(cpu, true);
        }
        LOGD("Forced all %d cores online", numCores);
    }

    // Set CPU frequency for all online cores
    for (int cpu = 0; cpu < numCores; cpu++) {
        if (!isCoreOnline(cpu)) continue;

        // Save original governor
        std::string govPath = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                              "/cpufreq/scaling_governor";
        std::string origGov = getCpuGovernor(cpu);
        if (!origGov.empty()) {
            std::lock_guard<std::mutex> lock(mutex_);
            originalSettings_[govPath] = origGov;
        }

        // Set to performance governor for max frequency
        setCpuGovernor(cpu, "performance");

        // Calculate and set frequency based on percentage
        long maxFreq = getMaxFrequency(cpu);
        long minFreq = getMinFrequency(cpu);

        if (maxFreq > 0 && maxFreqPercent < 100) {
            long targetFreq = minFreq + ((maxFreq - minFreq) * maxFreqPercent) / 100;

            // Save original max frequency
            std::string maxPath = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                                  "/cpufreq/scaling_max_freq";
            std::lock_guard<std::mutex> lock(mutex_);
            originalSettings_[maxPath] = std::to_string(maxFreq);

            setMaxFrequency(cpu, targetFreq);
            LOGD("CPU%d: Set max frequency to %ld kHz (%d%% of max)", cpu, targetFreq, maxFreqPercent);
        }
    }
}

void ThermalStressor::restoreSettings() {
    std::lock_guard<std::mutex> lock(mutex_);

    for (const auto& kv : originalSettings_) {
        writeSysFile(kv.first, kv.second);
        LOGD("Restored %s to %s", kv.first.c_str(), kv.second.c_str());
    }

    originalSettings_.clear();
    LOGD("All original CPU settings restored");
}

int ThermalStressor::getNumCores() const {
    int count = 0;
    DIR* dir = opendir("/sys/devices/system/cpu/");
    if (dir) {
        struct dirent* entry;
        while ((entry = readdir(dir)) != nullptr) {
            if (strncmp(entry->d_name, "cpu", 3) == 0) {
                char* endptr;
                long num = strtol(entry->d_name + 3, &endptr, 10);
                if (*endptr == '\0' && num >= 0) {
                    count++;
                }
            }
        }
        closedir(dir);
    }
    return count > 0 ? count : sysconf(_SC_NPROCESSORS_CONF);
}

bool ThermalStressor::setCoreOnline(int cpu, bool online) {
    if (cpu == 0) return true;  // CPU0 cannot be offlined

    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) + "/online";
    return writeSysFile(path, online ? "1" : "0");
}

bool ThermalStressor::isCoreOnline(int cpu) const {
    if (cpu == 0) return true;  // CPU0 is always online

    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) + "/online";
    std::string value = readSysFile(path);
    return value.find("1") != std::string::npos;
}

std::string ThermalStressor::getCpuGovernor(int cpu) const {
    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                       "/cpufreq/scaling_governor";
    return readSysFile(path);
}

bool ThermalStressor::setCpuGovernor(int cpu, const std::string& governor) {
    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                       "/cpufreq/scaling_governor";
    return writeSysFile(path, governor);
}

long ThermalStressor::getMaxFrequency(int cpu) const {
    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                       "/cpufreq/cpuinfo_max_freq";
    std::string value = readSysFile(path);
    return value.empty() ? 0 : std::stol(value);
}

long ThermalStressor::getMinFrequency(int cpu) const {
    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                       "/cpufreq/cpuinfo_min_freq";
    std::string value = readSysFile(path);
    return value.empty() ? 0 : std::stol(value);
}

bool ThermalStressor::setMaxFrequency(int cpu, long frequency) {
    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                       "/cpufreq/scaling_max_freq";
    return writeSysFile(path, std::to_string(frequency));
}

bool ThermalStressor::setMinFrequency(int cpu, long frequency) {
    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                       "/cpufreq/scaling_min_freq";
    return writeSysFile(path, std::to_string(frequency));
}

std::string ThermalStressor::readSysFile(const std::string& path) const {
    std::ifstream file(path);
    if (!file.is_open()) return "";

    std::string content;
    std::getline(file, content);

    // Trim whitespace
    size_t start = content.find_first_not_of(" \t\n\r");
    size_t end = content.find_last_not_of(" \t\n\r");
    if (start == std::string::npos) return "";

    return content.substr(start, end - start + 1);
}

bool ThermalStressor::writeSysFile(const std::string& path, const std::string& value) {
    std::ofstream file(path);
    if (!file.is_open()) {
        LOGE("Failed to open %s for writing", path.c_str());
        return false;
    }

    file << value;
    bool success = file.good();
    file.close();

    if (!success) {
        LOGE("Failed to write to %s", path.c_str());
    }

    return success;
}

StressStatus ThermalStressor::getStatus() const {
    StressStatus status;
    status.type = "thermal";
    status.isRunning = isRunning();
    status.remainingTimeMs = getRemainingTimeMs();

    if (status.isRunning) {
        std::lock_guard<std::mutex> lock(mutex_);
        status.data["totalCores"] = std::to_string(totalCores_.load());
        status.data["onlineCores"] = std::to_string(coresOnline_.load());
        status.data["maxFrequencyPercent"] = std::to_string(config_.maxFrequencyPercent);
        status.data["forceAllCoresOnline"] = config_.forceAllCoresOnline ? "true" : "false";
    }

    return status;
}

} // namespace danr
