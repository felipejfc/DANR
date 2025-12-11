#pragma once

#include "cpu_stressor.h"
#include "memory_stressor.h"
#include "disk_stressor.h"
#include "network_stressor.h"
#include "thermal_stressor.h"
#include <memory>
#include <mutex>

namespace danr {

class StressManager {
public:
    static StressManager& getInstance();

    // CPU stress controls
    bool startCpuStress(const CPUStressConfig& config);
    void stopCpuStress();
    StressStatus getCpuStatus() const;

    // Memory stress controls
    bool startMemoryStress(const MemoryStressConfig& config);
    void stopMemoryStress();
    StressStatus getMemoryStatus() const;

    // Disk stress controls
    bool startDiskStress(const DiskStressConfig& config);
    void stopDiskStress();
    StressStatus getDiskStatus() const;

    // Network stress controls
    bool startNetworkStress(const NetworkStressConfig& config);
    void stopNetworkStress();
    StressStatus getNetworkStatus() const;

    // Thermal stress controls
    bool startThermalStress(const ThermalStressConfig& config);
    void stopThermalStress();
    StressStatus getThermalStatus() const;

    // Global controls
    void stopAll();
    bool isAnyRunning() const;
    std::string getAllStatusJson() const;

private:
    StressManager();
    ~StressManager();
    StressManager(const StressManager&) = delete;
    StressManager& operator=(const StressManager&) = delete;

    std::unique_ptr<CPUStressor> cpuStressor_;
    std::unique_ptr<MemoryStressor> memoryStressor_;
    std::unique_ptr<DiskStressor> diskStressor_;
    std::unique_ptr<NetworkStressor> networkStressor_;
    std::unique_ptr<ThermalStressor> thermalStressor_;

    mutable std::mutex mutex_;
};

} // namespace danr
