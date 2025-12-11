#pragma once

#include "stressor_base.h"
#include <vector>
#include <thread>

namespace danr {

struct MemoryStressConfig {
    int targetFreeMB = 100;       // Target free memory to maintain
    int chunkSizeMB = 10;         // Allocation chunk size
    long durationMs = 300000;     // 5 minutes default
    bool useAnonymousMmap = true; // Use mmap for allocation
    bool lockMemory = false;      // Use mlock to prevent swapping (root)
};

class MemoryStressor : public StressorBase {
public:
    MemoryStressor() = default;
    ~MemoryStressor() override;

    bool start() override;
    bool start(const MemoryStressConfig& config);
    void stop() override;
    StressStatus getStatus() const override;
    std::string getType() const override { return "memory"; }

    void setConfig(const MemoryStressConfig& config);

private:
    MemoryStressConfig config_;
    std::thread workerThread_;
    std::vector<void*> allocations_;
    std::atomic<long> allocatedBytes_{0};

    void workerFunction();
    void releaseMemory();
    long getAvailableMemoryMB() const;
    void* allocateChunk(size_t size);
    void freeChunk(void* ptr, size_t size);
};

} // namespace danr
