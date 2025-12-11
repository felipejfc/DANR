#pragma once

#include "stressor_base.h"
#include <thread>
#include <string>

namespace danr {

struct DiskStressConfig {
    int throughputMBps = 5;       // Target throughput in MB/s
    int chunkSizeKB = 100;        // Write chunk size in KB
    long durationMs = 300000;     // 5 minutes default
    std::string testPath = "/data/local/tmp/danr_stress";
    bool useDirectIO = false;     // Use O_DIRECT to bypass cache (root)
    bool syncWrites = false;      // Force sync after each write
};

class DiskStressor : public StressorBase {
public:
    DiskStressor() = default;
    ~DiskStressor() override;

    bool start() override;
    bool start(const DiskStressConfig& config);
    void stop() override;
    StressStatus getStatus() const override;
    std::string getType() const override { return "disk_io"; }

    void setConfig(const DiskStressConfig& config);

private:
    DiskStressConfig config_;
    std::thread workerThread_;
    std::atomic<long> bytesWritten_{0};
    std::atomic<long> bytesRead_{0};

    void workerFunction();
    void cleanup();
    bool ensureDirectory(const std::string& path);
};

} // namespace danr
