#include "network_stressor.h"
#include <unistd.h>
#include <cstdio>
#include <sstream>
#include <android/log.h>

#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, "DANR-NetworkStressor", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "DANR-NetworkStressor", __VA_ARGS__)

namespace danr {

NetworkStressor::~NetworkStressor() {
    stop();
}

void NetworkStressor::setConfig(const NetworkStressConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_ = config;
}

bool NetworkStressor::start() {
    return start(config_);
}

bool NetworkStressor::start(const NetworkStressConfig& config) {
    if (isRunning()) {
        LOGD("Network stress test already running");
        return false;
    }

    if (!checkTcAvailable()) {
        LOGE("tc command not available - network stress requires root and busybox/tc");
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        config_ = config;
    }

    setDuration(config.durationMs);
    markStarted();

    LOGD("Starting network stress on %s: bandwidth=%d kbps, latency=%d ms, loss=%d%% for %ld ms",
         config.targetInterface.c_str(), config.bandwidthLimitKbps,
         config.latencyMs, config.packetLossPercent, config.durationMs);

    workerThread_ = std::thread(&NetworkStressor::workerFunction, this);
    return true;
}

void NetworkStressor::stop() {
    bool wasRunning = isRunning();

    if (wasRunning) {
        LOGD("Stopping network stress test");
        markStopped();
    }

    // Always try to join and cleanup, even if already stopped
    // (handles case where duration expired naturally)
    if (workerThread_.joinable()) {
        workerThread_.join();
    }

    removeTcRules();

    if (wasRunning) {
        LOGD("Network stress test stopped");
    }
}

void NetworkStressor::workerFunction() {
    long endTime;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        endTime = startTimeMs_.load() + durationMs_.load();
    }

    // Apply traffic control rules
    if (!applyTcRules()) {
        LOGE("Failed to apply tc rules");
        markStopped();
        return;
    }

    // Wait for duration while monitoring
    while (running_.load() && getCurrentTimeMs() < endTime) {
        usleep(1000000); // Check every second
    }

    // Mark as stopped when duration expires naturally
    markStopped();

    // Remove tc rules when test completes
    removeTcRules();

    LOGD("Network stress worker completed");
}

bool NetworkStressor::applyTcRules() {
    std::string iface;
    int bandwidthKbps;
    int latencyMs;
    int packetLoss;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        iface = config_.targetInterface;
        bandwidthKbps = config_.bandwidthLimitKbps;
        latencyMs = config_.latencyMs;
        packetLoss = config_.packetLossPercent;
    }

    // First remove any existing rules
    removeTcRules();

    // If no restrictions set, nothing to do
    if (bandwidthKbps == 0 && latencyMs == 0 && packetLoss == 0) {
        LOGD("No network restrictions configured");
        tcRulesApplied_.store(true);
        return true;
    }

    // Add root qdisc (HTB for bandwidth control)
    if (bandwidthKbps > 0) {
        std::stringstream cmd;
        cmd << "tc qdisc add dev " << iface << " root handle 1: htb default 12";
        if (!executeCommand(cmd.str())) {
            LOGE("Failed to add root qdisc");
            return false;
        }

        // Add class with bandwidth limit
        cmd.str("");
        cmd << "tc class add dev " << iface << " parent 1: classid 1:12 htb rate "
            << bandwidthKbps << "kbit ceil " << bandwidthKbps << "kbit";
        if (!executeCommand(cmd.str())) {
            LOGE("Failed to add htb class");
            removeTcRules();
            return false;
        }
    }

    // Add netem for latency and packet loss
    if (latencyMs > 0 || packetLoss > 0) {
        std::stringstream cmd;

        if (bandwidthKbps > 0) {
            // Add as child of htb class
            cmd << "tc qdisc add dev " << iface << " parent 1:12 handle 10: netem";
        } else {
            // Add as root qdisc
            cmd << "tc qdisc add dev " << iface << " root netem";
        }

        if (latencyMs > 0) {
            cmd << " delay " << latencyMs << "ms";
        }

        if (packetLoss > 0) {
            cmd << " loss " << packetLoss << "%";
        }

        if (!executeCommand(cmd.str())) {
            LOGE("Failed to add netem qdisc");
            removeTcRules();
            return false;
        }
    }

    tcRulesApplied_.store(true);
    LOGD("Network stress rules applied successfully");
    return true;
}

void NetworkStressor::removeTcRules() {
    if (!tcRulesApplied_.load()) return;

    std::string iface;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        iface = config_.targetInterface;
    }

    // Remove root qdisc (removes all child qdiscs too)
    std::string cmd = "tc qdisc del dev " + iface + " root 2>/dev/null";
    executeCommand(cmd);

    tcRulesApplied_.store(false);
    LOGD("Network stress rules removed");
}

bool NetworkStressor::executeCommand(const std::string& cmd, std::string* output) {
    LOGD("Executing: %s", cmd.c_str());

    FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe) {
        LOGE("Failed to execute command");
        return false;
    }

    if (output) {
        char buffer[256];
        while (fgets(buffer, sizeof(buffer), pipe)) {
            *output += buffer;
        }
    }

    int status = pclose(pipe);
    return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

bool NetworkStressor::checkTcAvailable() {
    std::string output;
    // Try to run tc without arguments to check if it exists
    if (executeCommand("which tc 2>/dev/null", &output)) {
        return !output.empty();
    }

    // Try common locations
    if (executeCommand("ls /system/bin/tc 2>/dev/null", &output)) {
        return !output.empty();
    }

    return false;
}

StressStatus NetworkStressor::getStatus() const {
    StressStatus status;
    status.type = "network";
    status.isRunning = isRunning();
    status.remainingTimeMs = getRemainingTimeMs();

    if (status.isRunning) {
        std::lock_guard<std::mutex> lock(mutex_);
        status.data["interface"] = config_.targetInterface;
        status.data["bandwidthLimitKbps"] = std::to_string(config_.bandwidthLimitKbps);
        status.data["latencyMs"] = std::to_string(config_.latencyMs);
        status.data["packetLossPercent"] = std::to_string(config_.packetLossPercent);
        status.data["rulesApplied"] = tcRulesApplied_.load() ? "true" : "false";
    }

    return status;
}

} // namespace danr
