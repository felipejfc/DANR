#include "stressor_base.h"
#include <sstream>

namespace danr {

std::string StressStatus::toJson() const {
    std::stringstream ss;
    ss << "{";
    ss << "\"type\":\"" << type << "\",";
    ss << "\"isRunning\":" << (isRunning ? "true" : "false") << ",";
    ss << "\"remainingTimeMs\":" << remainingTimeMs << ",";
    ss << "\"data\":{";
    bool first = true;
    for (const auto& kv : data) {
        if (!first) ss << ",";
        ss << "\"" << kv.first << "\":\"" << kv.second << "\"";
        first = false;
    }
    ss << "}}";
    return ss.str();
}

bool StressorBase::isRunning() const {
    return running_.load();
}

long StressorBase::getRemainingTimeMs() const {
    if (!running_.load()) return 0;
    long elapsed = getCurrentTimeMs() - startTimeMs_.load();
    long remaining = durationMs_.load() - elapsed;
    return remaining > 0 ? remaining : 0;
}

long StressorBase::getCurrentTimeMs() const {
    auto now = std::chrono::steady_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch());
    return ms.count();
}

void StressorBase::setDuration(long durationMs) {
    durationMs_.store(durationMs);
}

void StressorBase::markStarted() {
    startTimeMs_.store(getCurrentTimeMs());
    running_.store(true);
}

void StressorBase::markStopped() {
    running_.store(false);
}

} // namespace danr
