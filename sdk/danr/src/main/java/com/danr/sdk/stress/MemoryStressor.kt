package com.danr.sdk.stress

import android.app.ActivityManager
import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class MemoryStressor(
    private val scope: CoroutineScope,
    private val context: Context
) {
    private var stressJob: Job? = null
    private var startTime: Long = 0
    private var durationMs: Long = 0
    private val allocatedMemory = mutableListOf<ByteArray>()

    companion object {
        private const val TAG = "MemoryStressor"
        private const val CHUNK_SIZE_MB = 10
    }

    fun start(targetFreeMemoryMB: Int = 100, duration: Long = 300000) {
        if (isRunning()) {
            Log.w(TAG, "Memory stress test already running")
            return
        }

        startTime = System.currentTimeMillis()
        durationMs = duration

        Log.d(TAG, "Starting memory stress: target ${targetFreeMemoryMB}MB free for ${duration / 1000}s")

        stressJob = scope.launch(Dispatchers.Default) {
            try {
                val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                val memoryInfo = ActivityManager.MemoryInfo()

                // Phase 1: Allocate memory until we reach the target free memory
                Log.d(TAG, "Phase 1: Allocating memory to reach target")
                while (isActive) {
                    activityManager.getMemoryInfo(memoryInfo)
                    val currentFreeMB = memoryInfo.availMem / (1024 * 1024)

                    Log.d(TAG, "Current free memory: ${currentFreeMB}MB, Target: ${targetFreeMemoryMB}MB")

                    if (currentFreeMB <= targetFreeMemoryMB) {
                        Log.d(TAG, "Reached target free memory: ${currentFreeMB}MB")
                        break
                    }

                    // Allocate another chunk
                    try {
                        val chunk = ByteArray(CHUNK_SIZE_MB * 1024 * 1024)
                        // Fill with data to ensure allocation
                        for (j in chunk.indices step 1024) {
                            chunk[j] = (j % 256).toByte()
                        }
                        allocatedMemory.add(chunk)
                        Log.d(TAG, "Allocated ${allocatedMemory.size * CHUNK_SIZE_MB}MB total")
                    } catch (e: OutOfMemoryError) {
                        Log.w(TAG, "OutOfMemoryError reached, cannot allocate more")
                        break
                    }

                    delay(200) // Small delay between allocations
                }

                Log.d(TAG, "Total allocated: ${allocatedMemory.size * CHUNK_SIZE_MB}MB")

                // Phase 2: Maintain memory pressure and periodically check
                val endTime = System.currentTimeMillis() + duration
                Log.d(TAG, "Phase 2: Maintaining memory pressure")

                while (isActive && System.currentTimeMillis() < endTime) {
                    activityManager.getMemoryInfo(memoryInfo)
                    val currentFreeMB = memoryInfo.availMem / (1024 * 1024)

                    // If free memory increased significantly, allocate more
                    if (currentFreeMB > targetFreeMemoryMB + 50) {
                        try {
                            val chunk = ByteArray(CHUNK_SIZE_MB * 1024 * 1024)
                            for (j in chunk.indices step 1024) {
                                chunk[j] = (j % 256).toByte()
                            }
                            allocatedMemory.add(chunk)
                            Log.d(TAG, "Re-allocated to maintain pressure: ${allocatedMemory.size * CHUNK_SIZE_MB}MB total")
                        } catch (e: OutOfMemoryError) {
                            // Ignore, we're at the limit
                        }
                    }

                    // Access memory to keep it active and prevent GC
                    allocatedMemory.forEach { chunk ->
                        if (chunk.isNotEmpty()) {
                            chunk[0] = (chunk[0] + 1).toByte()
                        }
                    }

                    // Suggest GC to create pressure
                    System.gc()

                    delay(3000) // Check every 3 seconds
                }

                Log.d(TAG, "Memory stress test completed")
            } catch (e: Exception) {
                Log.e(TAG, "Error in memory stress test", e)
            } finally {
                releaseMemory()
            }
        }
    }

    fun stop() {
        stressJob?.cancel()
        stressJob = null
        releaseMemory()
        Log.d(TAG, "Memory stress test stopped")
    }

    private fun releaseMemory() {
        allocatedMemory.clear()
        System.gc()
        Log.d(TAG, "Memory released")
    }

    fun isRunning(): Boolean = stressJob?.isActive ?: false

    fun getRemainingTime(): Long {
        if (!isRunning()) return 0
        val elapsed = System.currentTimeMillis() - startTime
        return (durationMs - elapsed).coerceAtLeast(0)
    }

    fun getStatus(): StressStatus {
        return StressStatus(
            type = "memory",
            isRunning = isRunning(),
            remainingTimeMs = getRemainingTime(),
            data = mapOf("allocatedMB" to (allocatedMemory.size * CHUNK_SIZE_MB))
        )
    }
}
