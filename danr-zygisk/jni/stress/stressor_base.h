#pragma once

#include <string>
#include <atomic>
#include <thread>
#include <vector>
#include <map>
#include <mutex>
#include <chrono>

namespace danr {

struct StressStatus {
    std::string type;
    bool isRunning;
    long remainingTimeMs;
    std::map<std::string, std::string> data;

    std::string toJson() const;
};

class StressorBase {
public:
    virtual ~StressorBase() = default;

    virtual bool start() = 0;
    virtual void stop() = 0;
    virtual bool isRunning() const;
    virtual StressStatus getStatus() const = 0;
    virtual std::string getType() const = 0;

protected:
    std::atomic<bool> running_{false};
    std::atomic<long> startTimeMs_{0};
    std::atomic<long> durationMs_{0};
    mutable std::mutex mutex_;

    long getRemainingTimeMs() const;
    long getCurrentTimeMs() const;
    void setDuration(long durationMs);
    void markStarted();
    void markStopped();
};

} // namespace danr
