package com.danr.sdk

import android.content.Context
import android.util.Log
import com.danr.sdk.collectors.AppInfoCollector
import com.danr.sdk.collectors.DeviceInfoCollector
import com.danr.sdk.collectors.ThreadInfoCollector
import com.danr.sdk.detector.ANRDetector
import com.danr.sdk.models.ANRReport
import com.danr.sdk.reporter.ANRReporter
import com.danr.sdk.stress.StressTestManager
import com.danr.sdk.websocket.WebSocketClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object DANR {

    private var isInitialized = false
    private var config: DANRConfig? = null
    private var anrDetector: ANRDetector? = null
    private var anrReporter: ANRReporter? = null
    private var webSocketClient: WebSocketClient? = null
    private var stressTestManager: StressTestManager? = null
    private var deviceInfoCollector: DeviceInfoCollector? = null
    private var appInfoCollector: AppInfoCollector? = null
    private var threadInfoCollector: ThreadInfoCollector? = null
    private val scope = CoroutineScope(Dispatchers.Default + Job())

    private val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)

    fun initialize(context: Context, config: DANRConfig) {
        if (isInitialized) {
            Log.w(TAG, "DANR already initialized")
            return
        }

        this.config = config
        deviceInfoCollector = DeviceInfoCollector(context.applicationContext)
        appInfoCollector = AppInfoCollector(context.applicationContext)
        threadInfoCollector = ThreadInfoCollector()
        anrReporter = ANRReporter(config.backendUrl)
        stressTestManager = StressTestManager(context.applicationContext)
        webSocketClient = WebSocketClient(
            context.applicationContext,
            config.backendUrl,
            stressTestManager!!
        )

        isInitialized = true
        Log.d(TAG, "DANR initialized with backend: ${config.backendUrl}")

        // Connect WebSocket for remote control
        webSocketClient?.connect()

        if (config.autoStart) {
            start()
        }
    }

    fun start() {
        if (!isInitialized) {
            Log.e(TAG, "DANR not initialized. Call initialize() first")
            return
        }

        val currentConfig = config ?: return

        if (!shouldEnableForCurrentBuildType()) {
            Log.d(TAG, "DANR disabled for current build type")
            return
        }

        anrDetector = ANRDetector(currentConfig) { duration ->
            onANRDetected(duration)
        }

        anrDetector?.start()
        Log.d(TAG, "DANR started")
    }

    fun stop() {
        anrDetector?.stop()
        anrDetector = null
        stressTestManager?.stopAll()
        webSocketClient?.disconnect()
        Log.d(TAG, "DANR stopped")
    }

    private fun shouldEnableForCurrentBuildType(): Boolean {
        val currentConfig = config ?: return false
        val isDebugBuild = BuildConfig.DEBUG

        return if (isDebugBuild) {
            currentConfig.enableInDebug
        } else {
            currentConfig.enableInRelease
        }
    }

    private fun onANRDetected(duration: Long) {
        scope.launch {
            try {
                Log.d(TAG, "Collecting ANR data...")

                val allThreads = threadInfoCollector?.collectAllThreads() ?: emptyList()
                val mainThread = allThreads.firstOrNull { it.isMainThread }
                    ?: threadInfoCollector?.collectMainThread()
                    ?: return@launch

                val deviceInfo = deviceInfoCollector?.collect() ?: return@launch
                val appInfo = appInfoCollector?.collect() ?: return@launch

                val anrReport = ANRReport(
                    timestamp = dateFormat.format(Date()),
                    duration = duration,
                    mainThread = mainThread,
                    allThreads = allThreads,
                    deviceInfo = deviceInfo,
                    appInfo = appInfo
                )

                Log.d(TAG, "Sending ANR report to backend...")
                val success = anrReporter?.report(anrReport) ?: false

                if (success) {
                    Log.d(TAG, "ANR report sent successfully")
                } else {
                    Log.e(TAG, "Failed to send ANR report")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error handling ANR", e)
            }
        }
    }

    private const val TAG = "DANR"
}
