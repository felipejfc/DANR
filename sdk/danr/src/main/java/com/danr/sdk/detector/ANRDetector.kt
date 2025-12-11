package com.danr.sdk.detector

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.danr.sdk.DANRConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class ANRDetector(
    private val config: DANRConfig,
    private val onANRDetected: (Long) -> Unit
) {
    private val scope = CoroutineScope(Dispatchers.Default + Job())
    private val mainHandler = Handler(Looper.getMainLooper())
    private var isMonitoring = false

    @Volatile
    private var tick = 0

    @Volatile
    private var lastTick = 0

    fun start() {
        if (isMonitoring) {
            Log.d(TAG, "ANR detector already running")
            return
        }

        isMonitoring = true
        Log.d(TAG, "Starting ANR detector with threshold: ${config.anrThresholdMs}ms")

        scope.launch {
            while (isActive && isMonitoring) {
                lastTick = tick

                mainHandler.post {
                    tick = (tick + 1) % Int.MAX_VALUE
                }

                delay(config.anrThresholdMs)

                if (lastTick == tick && isMonitoring) {
                    val anrDuration = config.anrThresholdMs
                    Log.w(TAG, "ANR detected! Duration: ${anrDuration}ms")
                    onANRDetected(anrDuration)
                }
            }
        }
    }

    fun stop() {
        if (!isMonitoring) {
            Log.d(TAG, "ANR detector not running")
            return
        }

        isMonitoring = false
        Log.d(TAG, "Stopping ANR detector")
    }

    companion object {
        private const val TAG = "ANRDetector"
    }
}
