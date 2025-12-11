package com.danr.sdk.stress

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

class CPUStressor(private val scope: CoroutineScope) {
    private var stressJob: Job? = null
    private var startTime: Long = 0
    private var durationMs: Long = 0

    companion object {
        private const val TAG = "CPUStressor"
    }

    fun start(threadCount: Int = 4, loadPercentage: Int = 100, duration: Long = 300000) {
        if (isRunning()) {
            Log.w(TAG, "CPU stress test already running")
            return
        }

        startTime = System.currentTimeMillis()
        durationMs = duration

        Log.d(TAG, "Starting CPU stress: $threadCount threads at $loadPercentage% for ${duration / 1000}s")

        stressJob = scope.launch {
            val threads = (0 until threadCount).map { threadId ->
                launch(Dispatchers.Default) {
                    val endTime = System.currentTimeMillis() + duration
                    val workMs = 10 // Work for 10ms
                    val sleepMs = ((100 - loadPercentage) * workMs) / loadPercentage.coerceAtLeast(1)

                    while (isActive && System.currentTimeMillis() < endTime) {
                        // CPU-intensive work
                        val workEndTime = System.currentTimeMillis() + workMs
                        var result = 0.0
                        while (System.currentTimeMillis() < workEndTime) {
                            for (i in 0..1000) {
                                result += sqrt(i.toDouble()) + sin(i.toDouble()) + cos(i.toDouble())
                            }
                        }

                        // Sleep to achieve target load percentage
                        if (loadPercentage < 100 && sleepMs > 0) {
                            Thread.sleep(sleepMs.toLong())
                        }
                    }

                    Log.d(TAG, "CPU stress thread $threadId completed")
                }
            }

            threads.forEach { it.join() }
            Log.d(TAG, "CPU stress test completed")
            stressJob = null
        }
    }

    fun stop() {
        stressJob?.cancel()
        stressJob = null
        Log.d(TAG, "CPU stress test stopped")
    }

    fun isRunning(): Boolean = stressJob?.isActive ?: false

    fun getRemainingTime(): Long {
        if (!isRunning()) return 0
        val elapsed = System.currentTimeMillis() - startTime
        return (durationMs - elapsed).coerceAtLeast(0)
    }

    fun getStatus(): StressStatus {
        return StressStatus(
            type = "cpu",
            isRunning = isRunning(),
            remainingTimeMs = getRemainingTime()
        )
    }
}
