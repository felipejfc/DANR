#pragma once

#include "stressor_base.h"
#include <vector>
#include <thread>

namespace danr {

struct CPUStressConfig {
    int threadCount = 4;
    int loadPercentage = 100;  // 1-100
    long durationMs = 300000;  // 5 minutes default
    bool pinToCores = false;
    std::vector<int> targetCores;
};

class CPUStressor : public StressorBase {
public:
    CPUStressor() = default;
    ~CPUStressor() override;

    bool start() override;
    bool start(const CPUStressConfig& config);
    void stop() override;
    StressStatus getStatus() const override;
    std::string getType() const override { return "cpu"; }

    void setConfig(const CPUStressConfig& config);

private:
    CPUStressConfig config_;
    std::vector<std::thread> workerThreads_;
    std::atomic<long> totalOpsCompleted_{0};

    void workerFunction(int threadId, int coreId);
    int getNumCores() const;
    bool pinThreadToCore(int coreId);
};

} // namespace danr
