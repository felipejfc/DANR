#pragma once

#include <string>
#include <atomic>
#include <thread>
#include <vector>
#include <map>
#include <mutex>

namespace danr {

struct CPUFreqStatus {
    bool isLimited;
    long targetMaxFreq;
    long actualMaxFreq;
    long originalMaxFreq;
    int cores;
    std::vector<long> availableFreqs;
    long autoRestoreMs;
    long remainingRestoreMs;

    std::string toJson() const;
};

class CPUFreqManager {
public:
    static CPUFreqManager& getInstance();

    // Set max frequency for all cores (or specified cores)
    // autoRestoreMs: 0 = no auto-restore, >0 = auto-restore after this many ms
    bool setMaxFrequency(long frequency, const std::vector<int>& cores = {}, long autoRestoreMs = 0);

    // Restore original frequency
    bool restore();

    // Get current status
    CPUFreqStatus getStatus() const;

    // Called by webserver to update state (re-apply frequency, check timeouts)
    void tick();

private:
    CPUFreqManager();
    ~CPUFreqManager();

    // Prevent copying
    CPUFreqManager(const CPUFreqManager&) = delete;
    CPUFreqManager& operator=(const CPUFreqManager&) = delete;

    // State
    mutable std::mutex mutex_;
    std::atomic<bool> isLimited_{false};
    std::atomic<long> targetMaxFreq_{0};
    std::atomic<long> originalMaxFreq_{0};
    std::atomic<long> autoRestoreMs_{0};
    std::atomic<long> limitStartTimeMs_{0};
    std::vector<int> targetCores_;
    std::map<std::string, std::string> originalSettings_;

    // Background thread for re-applying frequency
    std::thread workerThread_;
    std::atomic<bool> workerRunning_{false};

    void startWorker();
    void stopWorker();
    void workerFunction();

    // CPU control functions
    int getNumCores() const;
    long getCurrentMaxFreq(int cpu) const;
    long getHardwareMaxFreq(int cpu) const;
    std::vector<long> getAvailableFrequencies(int cpu) const;
    bool setCpuMaxFreq(int cpu, long frequency);

    // File helpers
    std::string readSysFile(const std::string& path) const;
    bool writeSysFile(const std::string& path, const std::string& value);

    // Time helper
    long getCurrentTimeMs() const;
};

} // namespace danr
