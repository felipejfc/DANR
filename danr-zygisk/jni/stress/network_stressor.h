#pragma once

#include "stressor_base.h"
#include <thread>
#include <string>

namespace danr {

struct NetworkStressConfig {
    int bandwidthLimitKbps = 0;   // 0 = unlimited, >0 = limit via tc
    int latencyMs = 0;            // Added latency via tc netem
    int packetLossPercent = 0;    // Simulated packet loss (0-100)
    long durationMs = 300000;     // 5 minutes default
    std::string targetInterface = "wlan0";
};

class NetworkStressor : public StressorBase {
public:
    NetworkStressor() = default;
    ~NetworkStressor() override;

    bool start() override;
    bool start(const NetworkStressConfig& config);
    void stop() override;
    StressStatus getStatus() const override;
    std::string getType() const override { return "network"; }

    void setConfig(const NetworkStressConfig& config);

private:
    NetworkStressConfig config_;
    std::thread workerThread_;
    std::atomic<bool> tcRulesApplied_{false};

    void workerFunction();
    bool applyTcRules();
    void removeTcRules();
    bool executeCommand(const std::string& cmd, std::string* output = nullptr);
    bool checkTcAvailable();
};

} // namespace danr
