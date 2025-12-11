package com.danr.sdk.stress

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job

class StressTestManager(private val context: Context) {
    private val scope = CoroutineScope(Dispatchers.Default + Job())
    private val cpuStressor = CPUStressor(scope)
    private val memoryStressor = MemoryStressor(scope, context)
    private val diskIOStressor = DiskIOStressor(context, scope)

    companion object {
        private const val TAG = "StressTestManager"
        private const val DEFAULT_DURATION_MS = 300000L // 5 minutes
    }

    fun startCPUStress(threadCount: Int = 4, loadPercentage: Int = 100, durationMs: Long = DEFAULT_DURATION_MS): Boolean {
        return try {
            cpuStressor.start(threadCount, loadPercentage, durationMs)
            Log.d(TAG, "CPU stress started")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start CPU stress", e)
            false
        }
    }

    fun startMemoryStress(targetMemoryMB: Int = 100, durationMs: Long = DEFAULT_DURATION_MS): Boolean {
        return try {
            memoryStressor.start(targetMemoryMB, durationMs)
            Log.d(TAG, "Memory stress started")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start memory stress", e)
            false
        }
    }

    fun startDiskIOStress(throughputMBps: Int = 5, durationMs: Long = DEFAULT_DURATION_MS): Boolean {
        return try {
            diskIOStressor.start(throughputMBps, durationMs)
            Log.d(TAG, "Disk I/O stress started")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start disk I/O stress", e)
            false
        }
    }

    fun stopCPUStress() {
        cpuStressor.stop()
        Log.d(TAG, "CPU stress stopped")
    }

    fun stopMemoryStress() {
        memoryStressor.stop()
        Log.d(TAG, "Memory stress stopped")
    }

    fun stopDiskIOStress() {
        diskIOStressor.stop()
        Log.d(TAG, "Disk I/O stress stopped")
    }

    fun stopAll() {
        stopCPUStress()
        stopMemoryStress()
        stopDiskIOStress()
        Log.d(TAG, "All stress tests stopped")
    }

    fun getStatus(): List<StressStatus> {
        return listOf(
            cpuStressor.getStatus(),
            memoryStressor.getStatus(),
            diskIOStressor.getStatus()
        )
    }

    fun isAnyRunning(): Boolean {
        return cpuStressor.isRunning() || memoryStressor.isRunning() || diskIOStressor.isRunning()
    }
}
