#pragma once

#include "stressor_base.h"
#include <thread>
#include <string>
#include <map>

namespace danr {

struct ThermalStressConfig {
    bool disableThermalThrottling = false;  // Try to disable thermal daemon
    int maxFrequencyPercent = 100;          // Lock CPU freq to percentage of max
    bool forceAllCoresOnline = true;        // Prevent core hotplugging
    long durationMs = 300000;               // 5 minutes default
};

class ThermalStressor : public StressorBase {
public:
    ThermalStressor() = default;
    ~ThermalStressor() override;

    bool start() override;
    bool start(const ThermalStressConfig& config);
    void stop() override;
    StressStatus getStatus() const override;
    std::string getType() const override { return "thermal"; }

    void setConfig(const ThermalStressConfig& config);

private:
    ThermalStressConfig config_;
    std::thread workerThread_;
    std::map<std::string, std::string> originalSettings_;
    std::atomic<int> coresOnline_{0};
    std::atomic<int> totalCores_{0};

    void workerFunction();
    void applySettings();
    void restoreSettings();

    // CPU control functions
    int getNumCores() const;
    bool setCoreOnline(int cpu, bool online);
    bool isCoreOnline(int cpu) const;

    // Frequency control functions
    std::string getCpuGovernor(int cpu) const;
    bool setCpuGovernor(int cpu, const std::string& governor);
    long getMaxFrequency(int cpu) const;
    long getMinFrequency(int cpu) const;
    bool setMaxFrequency(int cpu, long frequency);
    bool setMinFrequency(int cpu, long frequency);

    // File helpers
    std::string readSysFile(const std::string& path) const;
    bool writeSysFile(const std::string& path, const std::string& value);
};

} // namespace danr
