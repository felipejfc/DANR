#include "cpu_freq_manager.h"
#include <fstream>
#include <sstream>
#include <unistd.h>
#include <dirent.h>
#include <android/log.h>
#include <algorithm>
#include <chrono>

#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, "DANR-CPUFreqMgr", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "DANR-CPUFreqMgr", __VA_ARGS__)

namespace danr {

// JSON helper for CPUFreqStatus
std::string CPUFreqStatus::toJson() const {
    std::ostringstream ss;
    ss << "{";
    ss << "\"isLimited\":" << (isLimited ? "true" : "false") << ",";
    ss << "\"targetMaxFreq\":" << targetMaxFreq << ",";
    ss << "\"actualMaxFreq\":" << actualMaxFreq << ",";
    ss << "\"originalMaxFreq\":" << originalMaxFreq << ",";
    ss << "\"cores\":" << cores << ",";
    ss << "\"availableFreqs\":[";
    for (size_t i = 0; i < availableFreqs.size(); i++) {
        if (i > 0) ss << ",";
        ss << availableFreqs[i];
    }
    ss << "],";
    ss << "\"autoRestoreMs\":" << autoRestoreMs << ",";
    ss << "\"remainingRestoreMs\":" << remainingRestoreMs;
    ss << "}";
    return ss.str();
}

CPUFreqManager& CPUFreqManager::getInstance() {
    static CPUFreqManager instance;
    return instance;
}

CPUFreqManager::CPUFreqManager() {
    // Read initial original max freq
    originalMaxFreq_.store(getHardwareMaxFreq(0));
    LOGD("CPUFreqManager initialized, original max freq: %ld kHz", originalMaxFreq_.load());
}

CPUFreqManager::~CPUFreqManager() {
    stopWorker();
    restore();
}

bool CPUFreqManager::setMaxFrequency(long frequency, const std::vector<int>& cores, long autoRestoreMs) {
    std::lock_guard<std::mutex> lock(mutex_);

    int numCores = getNumCores();
    std::vector<int> targetCores = cores.empty() ?
        std::vector<int>() : cores;

    // If no specific cores, target all cores
    if (targetCores.empty()) {
        for (int i = 0; i < numCores; i++) {
            targetCores.push_back(i);
        }
    }

    // Save original settings if this is the first time limiting
    if (!isLimited_.load()) {
        originalSettings_.clear();
        for (int cpu : targetCores) {
            std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                              "/cpufreq/scaling_max_freq";
            long origFreq = getCurrentMaxFreq(cpu);
            if (origFreq > 0) {
                originalSettings_[path] = std::to_string(origFreq);
            }
        }
        originalMaxFreq_.store(getHardwareMaxFreq(0));
    }

    // Apply frequency to all target cores
    bool allSuccess = true;
    for (int cpu : targetCores) {
        if (!setCpuMaxFreq(cpu, frequency)) {
            LOGE("Failed to set frequency for CPU%d", cpu);
            allSuccess = false;
        }
    }

    if (allSuccess) {
        targetCores_ = targetCores;
        targetMaxFreq_.store(frequency);
        autoRestoreMs_.store(autoRestoreMs);
        limitStartTimeMs_.store(getCurrentTimeMs());
        isLimited_.store(true);

        LOGD("Set max frequency to %ld kHz for %zu cores, auto-restore: %ld ms",
             frequency, targetCores.size(), autoRestoreMs);

        // Start worker thread if not running
        if (!workerRunning_.load()) {
            startWorker();
        }
    }

    return allSuccess;
}

bool CPUFreqManager::restore() {
    // Stop worker thread first (outside of mutex to avoid potential deadlock)
    stopWorker();

    std::lock_guard<std::mutex> lock(mutex_);

    if (!isLimited_.load()) {
        return true;
    }

    LOGD("Restoring original CPU frequencies");

    // Restore all saved settings
    for (const auto& kv : originalSettings_) {
        writeSysFile(kv.first, kv.second);
        LOGD("Restored %s to %s", kv.first.c_str(), kv.second.c_str());
    }

    originalSettings_.clear();
    targetCores_.clear();
    targetMaxFreq_.store(0);
    autoRestoreMs_.store(0);
    limitStartTimeMs_.store(0);
    isLimited_.store(false);

    LOGD("CPU frequencies restored");
    return true;
}

CPUFreqStatus CPUFreqManager::getStatus() const {
    CPUFreqStatus status;

    status.isLimited = isLimited_.load();
    status.targetMaxFreq = targetMaxFreq_.load();
    status.originalMaxFreq = originalMaxFreq_.load();
    status.cores = getNumCores();
    status.availableFreqs = getAvailableFrequencies(0);
    status.autoRestoreMs = autoRestoreMs_.load();

    // Calculate remaining restore time
    if (status.isLimited && status.autoRestoreMs > 0) {
        long elapsed = getCurrentTimeMs() - limitStartTimeMs_.load();
        status.remainingRestoreMs = std::max(0L, status.autoRestoreMs - elapsed);
    } else {
        status.remainingRestoreMs = 0;
    }

    // Read actual current max freq (average across cores or just cpu0)
    status.actualMaxFreq = getCurrentMaxFreq(0);

    return status;
}

void CPUFreqManager::tick() {
    if (!isLimited_.load()) {
        return;
    }

    // Check auto-restore timeout
    long autoRestore = autoRestoreMs_.load();
    if (autoRestore > 0) {
        long elapsed = getCurrentTimeMs() - limitStartTimeMs_.load();
        if (elapsed >= autoRestore) {
            LOGD("Auto-restore timeout reached, restoring frequencies");
            restore();
            return;
        }
    }

    // Re-apply frequency to counter system changes
    long targetFreq = targetMaxFreq_.load();
    std::vector<int> cores;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        cores = targetCores_;
    }

    for (int cpu : cores) {
        long currentFreq = getCurrentMaxFreq(cpu);
        if (currentFreq != targetFreq) {
            LOGD("CPU%d freq changed to %ld, re-applying %ld", cpu, currentFreq, targetFreq);
            setCpuMaxFreq(cpu, targetFreq);
        }
    }
}

void CPUFreqManager::startWorker() {
    if (workerRunning_.load()) {
        return;
    }

    // Join any previous thread that may have exited naturally
    if (workerThread_.joinable()) {
        workerThread_.join();
    }

    workerRunning_.store(true);
    workerThread_ = std::thread(&CPUFreqManager::workerFunction, this);
    LOGD("Worker thread started");
}

void CPUFreqManager::stopWorker() {
    if (!workerRunning_.load()) {
        return;
    }

    workerRunning_.store(false);
    if (workerThread_.joinable()) {
        workerThread_.join();
    }
    LOGD("Worker thread stopped");
}

void CPUFreqManager::workerFunction() {
    while (workerRunning_.load()) {
        tick();

        // If no longer limited, stop the worker
        if (!isLimited_.load()) {
            break;
        }

        // Sleep for 1.5 seconds before next tick
        usleep(1500000);
    }

    workerRunning_.store(false);
    LOGD("Worker function exited");
}

int CPUFreqManager::getNumCores() const {
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

long CPUFreqManager::getCurrentMaxFreq(int cpu) const {
    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                       "/cpufreq/scaling_max_freq";
    std::string value = readSysFile(path);
    if (value.empty()) return 0;
    try {
        return std::stol(value);
    } catch (...) {
        LOGE("Failed to parse frequency from %s: %s", path.c_str(), value.c_str());
        return 0;
    }
}

long CPUFreqManager::getHardwareMaxFreq(int cpu) const {
    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                       "/cpufreq/cpuinfo_max_freq";
    std::string value = readSysFile(path);
    if (value.empty()) return 0;
    try {
        return std::stol(value);
    } catch (...) {
        LOGE("Failed to parse hardware max freq from %s: %s", path.c_str(), value.c_str());
        return 0;
    }
}

std::vector<long> CPUFreqManager::getAvailableFrequencies(int cpu) const {
    std::vector<long> freqs;
    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                       "/cpufreq/scaling_available_frequencies";
    std::string value = readSysFile(path);

    if (!value.empty()) {
        std::istringstream iss(value);
        long freq;
        while (iss >> freq) {
            freqs.push_back(freq);
        }
        std::sort(freqs.begin(), freqs.end());
    }

    return freqs;
}

bool CPUFreqManager::setCpuMaxFreq(int cpu, long frequency) {
    std::string path = "/sys/devices/system/cpu/cpu" + std::to_string(cpu) +
                       "/cpufreq/scaling_max_freq";
    return writeSysFile(path, std::to_string(frequency));
}

std::string CPUFreqManager::readSysFile(const std::string& path) const {
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

bool CPUFreqManager::writeSysFile(const std::string& path, const std::string& value) {
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

long CPUFreqManager::getCurrentTimeMs() const {
    auto now = std::chrono::system_clock::now();
    auto duration = now.time_since_epoch();
    return std::chrono::duration_cast<std::chrono::milliseconds>(duration).count();
}

} // namespace danr
