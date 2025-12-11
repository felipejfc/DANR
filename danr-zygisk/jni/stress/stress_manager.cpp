#include "stress_manager.h"
#include <sstream>
#include <android/log.h>

#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, "DANR-StressManager", __VA_ARGS__)

namespace danr {

StressManager& StressManager::getInstance() {
    static StressManager instance;
    return instance;
}

StressManager::StressManager()
    : cpuStressor_(std::make_unique<CPUStressor>())
    , memoryStressor_(std::make_unique<MemoryStressor>())
    , diskStressor_(std::make_unique<DiskStressor>())
    , networkStressor_(std::make_unique<NetworkStressor>())
    , thermalStressor_(std::make_unique<ThermalStressor>())
{
    LOGD("StressManager initialized");
}

StressManager::~StressManager() {
    stopAll();
    LOGD("StressManager destroyed");
}

// CPU stress
bool StressManager::startCpuStress(const CPUStressConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    return cpuStressor_->start(config);
}

void StressManager::stopCpuStress() {
    std::lock_guard<std::mutex> lock(mutex_);
    cpuStressor_->stop();
}

StressStatus StressManager::getCpuStatus() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return cpuStressor_->getStatus();
}

// Memory stress
bool StressManager::startMemoryStress(const MemoryStressConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    return memoryStressor_->start(config);
}

void StressManager::stopMemoryStress() {
    std::lock_guard<std::mutex> lock(mutex_);
    memoryStressor_->stop();
}

StressStatus StressManager::getMemoryStatus() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return memoryStressor_->getStatus();
}

// Disk stress
bool StressManager::startDiskStress(const DiskStressConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    return diskStressor_->start(config);
}

void StressManager::stopDiskStress() {
    std::lock_guard<std::mutex> lock(mutex_);
    diskStressor_->stop();
}

StressStatus StressManager::getDiskStatus() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return diskStressor_->getStatus();
}

// Network stress
bool StressManager::startNetworkStress(const NetworkStressConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    return networkStressor_->start(config);
}

void StressManager::stopNetworkStress() {
    std::lock_guard<std::mutex> lock(mutex_);
    networkStressor_->stop();
}

StressStatus StressManager::getNetworkStatus() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return networkStressor_->getStatus();
}

// Thermal stress
bool StressManager::startThermalStress(const ThermalStressConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    return thermalStressor_->start(config);
}

void StressManager::stopThermalStress() {
    std::lock_guard<std::mutex> lock(mutex_);
    thermalStressor_->stop();
}

StressStatus StressManager::getThermalStatus() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return thermalStressor_->getStatus();
}

// Global controls
void StressManager::stopAll() {
    LOGD("Stopping all stress tests");
    std::lock_guard<std::mutex> lock(mutex_);
    cpuStressor_->stop();
    memoryStressor_->stop();
    diskStressor_->stop();
    networkStressor_->stop();
    thermalStressor_->stop();
}

bool StressManager::isAnyRunning() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return cpuStressor_->isRunning() ||
           memoryStressor_->isRunning() ||
           diskStressor_->isRunning() ||
           networkStressor_->isRunning() ||
           thermalStressor_->isRunning();
}

std::string StressManager::getAllStatusJson() const {
    std::lock_guard<std::mutex> lock(mutex_);

    std::stringstream ss;
    ss << "{";
    ss << "\"cpu\":" << cpuStressor_->getStatus().toJson() << ",";
    ss << "\"memory\":" << memoryStressor_->getStatus().toJson() << ",";
    ss << "\"disk_io\":" << diskStressor_->getStatus().toJson() << ",";
    ss << "\"network\":" << networkStressor_->getStatus().toJson() << ",";
    ss << "\"thermal\":" << thermalStressor_->getStatus().toJson();
    ss << "}";

    return ss.str();
}

} // namespace danr
