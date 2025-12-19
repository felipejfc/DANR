package com.danr.sdk.websocket

import android.content.Context
import android.os.Build
import android.util.Log
import com.danr.sdk.profiler.CPUProfiler
import com.danr.sdk.profiler.ProfileSession
import com.danr.sdk.shell.CPUFrequencyManager
import com.danr.sdk.shell.CPUInfo
import com.danr.sdk.shell.RootExecutor
import com.danr.sdk.stress.StressTestManager
import com.danr.sdk.triggers.ANRTriggers
import com.google.gson.Gson
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

class WebSocketClient(
    private val context: Context,
    private val backendUrl: String,
    private val stressTestManager: StressTestManager,
    private val cpuProfiler: CPUProfiler? = null
) {
    private var socket: Socket? = null
    private val deviceId = getDeviceId()
    private val gson = Gson()
    private val scope = CoroutineScope(Dispatchers.Default + Job())
    private lateinit var cpuManager: CPUFrequencyManager
    private var autoRestoreJob: Job? = null
    private var profileStatusJob: Job? = null

    companion object {
        private const val TAG = "WebSocketClient"
        private const val AUTO_RESTORE_TIMEOUT_MS = 60000L // 60 seconds
        private const val PROFILE_STATUS_UPDATE_INTERVAL_MS = 500L // Update UI every 500ms
    }

    fun connect() {
        try {
            cpuManager = CPUFrequencyManager(context)

            val opts = IO.Options().apply {
                reconnection = true
                reconnectionDelay = 1000
                reconnectionAttempts = Int.MAX_VALUE
            }

            socket = IO.socket(backendUrl, opts)

            socket?.apply {
                on(Socket.EVENT_CONNECT) {
                    Log.d(TAG, "Connected to backend")
                    registerDevice()
                }

                on(Socket.EVENT_DISCONNECT) {
                    Log.d(TAG, "Disconnected from backend")
                    // Auto-restore CPU settings on disconnect
                    scope.launch {
                        cpuManager.restoreOriginalFrequency()
                    }
                }

                on(Socket.EVENT_CONNECT_ERROR) { args ->
                    Log.e(TAG, "Connection error: ${args.joinToString()}")
                }

                on("device:registered") { args ->
                    Log.d(TAG, "Device registered successfully")
                }

                on("device:command") { args ->
                    handleCommand(args)
                }

                connect()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error connecting to backend", e)
        }
    }

    fun disconnect() {
        autoRestoreJob?.cancel()
        socket?.disconnect()
        socket?.close()
    }

    private fun registerDevice() {
        scope.launch {
            val hasRoot = RootExecutor.isRootAvailable()
            val cpuInfo = if (hasRoot) cpuManager.getCPUInfo() else null

            val deviceInfo = JSONObject().apply {
                put("deviceId", deviceId)
                put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("androidVersion", Build.VERSION.RELEASE)
                put("hasRoot", hasRoot)

                cpuInfo?.let {
                    put("cpuInfo", JSONObject().apply {
                        put("cores", it.cores)
                        put("currentMaxFreq", it.currentMaxFreq)
                        put("originalMaxFreq", it.originalMaxFreq)
                        put("availableFreqs", org.json.JSONArray(it.availableFreqs))
                    })
                }
            }

            socket?.emit("device:register", deviceInfo)
        }
    }

    private fun handleCommand(args: Array<Any>) {
        if (args.isEmpty()) return

        try {
            val commandJson = args[0] as JSONObject
            val type = commandJson.getString("type")
            val params = commandJson.optJSONObject("params")

            Log.d(TAG, "Received command: $type")

            scope.launch {
                val response = when (type) {
                    "set_cpu_freq" -> handleSetCPUFreq(params)
                    "restore_cpu" -> handleRestoreCPU()
                    "trigger_anr" -> handleTriggerANR(params)
                    "toggle_core" -> handleToggleCore(params)
                    "get_status" -> handleGetStatus()
                    "start_stress_test" -> handleStartStressTest(params)
                    "stop_stress_test" -> handleStopStressTest(params)
                    "get_stress_status" -> handleGetStressStatus()
                    "start_profiling" -> handleStartProfiling(params)
                    "stop_profiling" -> handleStopProfiling()
                    "get_profile_status" -> handleGetProfileStatus()
                    else -> createResponse(false, "Unknown command type: $type")
                }

                sendResponse(commandJson, response)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error handling command", e)
        }
    }

    private suspend fun handleSetCPUFreq(params: JSONObject?): JSONObject {
        if (params == null) {
            return createResponse(false, "Missing parameters")
        }

        val frequency = params.getInt("frequency")
        val coresArray = params.optJSONArray("cores")
        val cores = coresArray?.let {
            (0 until it.length()).map { i -> it.getInt(i) }
        }

        val success = cpuManager.setMaxFrequency(frequency, cores)

        if (success) {
            // Start auto-restore timer
            scheduleAutoRestore()

            // Send updated CPU info to backend
            sendCPUStatus()
        }

        return createResponse(
            success,
            if (success) "CPU frequency set to $frequency" else "Failed to set CPU frequency"
        )
    }

    private suspend fun handleRestoreCPU(): JSONObject {
        cancelAutoRestore()
        val success = cpuManager.restoreOriginalFrequency()

        if (success) {
            // Send updated CPU info to backend
            sendCPUStatus()
        }

        return createResponse(
            success,
            if (success) "CPU frequency restored" else "Failed to restore CPU frequency"
        )
    }

    private fun handleTriggerANR(params: JSONObject?): JSONObject {
        if (params == null) {
            return createResponse(false, "Missing parameters")
        }

        val anrType = params.getString("type")
        // Backward/forward compatible: older clients used "duration", newer uses "durationMs"
        val duration = params.optLong("durationMs", params.optLong("duration", 5000L))

        try {
            when (anrType) {
                "infinite_loop" -> ANRTriggers.triggerInfiniteLoop(duration)
                "sleep" -> ANRTriggers.triggerSleep(duration)
                "heavy_computation" -> ANRTriggers.triggerHeavyComputation(duration)
                "memory_stress" -> {
                    val sizeMB = params.optInt("sizeMB", 100)
                    ANRTriggers.triggerMemoryStress(sizeMB, duration)
                }
                "disk_io" -> ANRTriggers.triggerDiskIO(duration, context.cacheDir)
                "network" -> ANRTriggers.triggerSynchronousNetwork(duration.toInt())
                else -> return createResponse(false, "Unknown ANR type: $anrType")
            }

            return createResponse(true, "ANR trigger started: $anrType")
        } catch (e: Exception) {
            return createResponse(false, "Error triggering ANR: ${e.message}")
        }
    }

    private suspend fun handleToggleCore(params: JSONObject?): JSONObject {
        if (params == null) {
            return createResponse(false, "Missing parameters")
        }

        // Backward/forward compatible: accept both {coreId, enabled} and {core, enable}
        val coreId = when {
            params.has("coreId") -> params.getInt("coreId")
            params.has("core") -> params.getInt("core")
            else -> return createResponse(false, "Missing parameter: coreId")
        }

        val enabled = when {
            params.has("enabled") -> params.getBoolean("enabled")
            params.has("enable") -> params.getBoolean("enable")
            else -> return createResponse(false, "Missing parameter: enabled")
        }

        val success = cpuManager.toggleCore(coreId, enabled)

        return createResponse(
            success,
            if (success) "Core $coreId ${if (enabled) "enabled" else "disabled"}"
            else "Failed to toggle core $coreId"
        )
    }

    private suspend fun handleGetStatus(): JSONObject {
        val cpuInfo = cpuManager.getCPUInfo()
        val coreStatus = cpuManager.getCoreStatus()

        return JSONObject().apply {
            put("success", true)
            cpuInfo?.let {
                put("cpuInfo", JSONObject().apply {
                    put("cores", it.cores)
                    put("currentMaxFreq", it.currentMaxFreq)
                    put("originalMaxFreq", it.originalMaxFreq)
                    put("availableFreqs", org.json.JSONArray(it.availableFreqs))
                })
            }
            put("coreStatus", JSONObject(coreStatus.mapKeys { it.key.toString() }))
        }
    }

    private fun sendResponse(command: JSONObject, response: JSONObject) {
        val payload = JSONObject().apply {
            put("deviceId", deviceId)
            put("command", command)
            put("response", response)
        }

        socket?.emit("device:response", payload)
    }

    private fun createResponse(success: Boolean, message: String, data: Any? = null): JSONObject {
        return JSONObject().apply {
            put("success", success)
            put("message", message)
            data?.let { put("data", it) }
        }
    }

    private fun scheduleAutoRestore() {
        cancelAutoRestore()

        autoRestoreJob = scope.launch {
            delay(AUTO_RESTORE_TIMEOUT_MS)
            Log.d(TAG, "Auto-restoring CPU frequency after timeout")
            cpuManager.restoreOriginalFrequency()
        }
    }

    private fun cancelAutoRestore() {
        autoRestoreJob?.cancel()
        autoRestoreJob = null
    }

    private fun sendCPUStatus() {
        scope.launch {
            val cpuInfo = cpuManager.getCPUInfo()

            cpuInfo?.let {
                val payload = JSONObject().apply {
                    put("deviceId", deviceId)
                    put("cpuInfo", JSONObject().apply {
                        put("cores", it.cores)
                        put("currentMaxFreq", it.currentMaxFreq)
                        put("originalMaxFreq", it.originalMaxFreq)
                        put("availableFreqs", org.json.JSONArray(it.availableFreqs))
                    })
                }

                socket?.emit("device:status", payload)
                Log.d(TAG, "Sent updated CPU status: currentMaxFreq=${it.currentMaxFreq}")
            }
        }
    }

    private fun handleStartStressTest(params: JSONObject?): JSONObject {
        if (params == null) {
            return createResponse(false, "Missing parameters")
        }

        val stressType = params.getString("type")
        val durationMs = params.optLong("durationMs", 300000)

        return try {
            val success = when (stressType) {
                "cpu" -> {
                    val threadCount = params.optInt("threadCount", 4)
                    val loadPercentage = params.optInt("loadPercentage", 100)
                    stressTestManager.startCPUStress(threadCount, loadPercentage, durationMs)
                }
                "memory" -> {
                    val targetMemoryMB = params.optInt("targetMemoryMB", 100)
                    stressTestManager.startMemoryStress(targetMemoryMB, durationMs)
                }
                "disk_io" -> {
                    val throughputMBps = params.optInt("throughputMBps", 5)
                    stressTestManager.startDiskIOStress(throughputMBps, durationMs)
                }
                else -> {
                    return createResponse(false, "Unknown stress test type: $stressType")
                }
            }

            if (success) {
                // Send status update
                sendStressStatus()
            }

            createResponse(
                success,
                if (success) "Stress test started: $stressType" else "Failed to start stress test: $stressType"
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error starting stress test", e)
            createResponse(false, "Error: ${e.message}")
        }
    }

    private fun handleStopStressTest(params: JSONObject?): JSONObject {
        return try {
            val stressType = params?.optString("type", "all") ?: "all"

            when (stressType) {
                "cpu" -> stressTestManager.stopCPUStress()
                "memory" -> stressTestManager.stopMemoryStress()
                "disk_io" -> stressTestManager.stopDiskIOStress()
                "all" -> stressTestManager.stopAll()
                else -> {
                    return createResponse(false, "Unknown stress test type: $stressType")
                }
            }

            // Send status update
            sendStressStatus()

            createResponse(true, "Stress test stopped: $stressType")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping stress test", e)
            createResponse(false, "Error: ${e.message}")
        }
    }

    private fun handleGetStressStatus(): JSONObject {
        return try {
            val statuses = stressTestManager.getStatus()
            val statusArray = org.json.JSONArray()

            statuses.forEach { status ->
                statusArray.put(JSONObject().apply {
                    put("type", status.type)
                    put("isRunning", status.isRunning)
                    put("remainingTimeMs", status.remainingTimeMs)
                    status.data?.let { data ->
                        put("data", JSONObject(data))
                    }
                })
            }

            createResponse(true, "Stress status", statusArray)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting stress status", e)
            createResponse(false, "Error: ${e.message}")
        }
    }

    private fun sendStressStatus() {
        scope.launch {
            val statuses = stressTestManager.getStatus()
            val statusArray = org.json.JSONArray()

            statuses.forEach { status ->
                statusArray.put(JSONObject().apply {
                    put("type", status.type)
                    put("isRunning", status.isRunning)
                    put("remainingTimeMs", status.remainingTimeMs)
                    status.data?.let { data ->
                        put("data", JSONObject(data))
                    }
                })
            }

            val payload = JSONObject().apply {
                put("deviceId", deviceId)
                put("stressStatuses", statusArray)
            }

            socket?.emit("stress:status", payload)
            Log.d(TAG, "Sent stress status update")
        }
    }

    // Profiling handlers

    private suspend fun handleStartProfiling(params: JSONObject?): JSONObject {
        if (cpuProfiler == null) {
            return createResponse(false, "CPU profiler not initialized")
        }

        val samplingIntervalMs = params?.optInt("samplingIntervalMs", 50) ?: 50
        val maxDurationMs = params?.optLong("maxDurationMs", 60000) ?: 60000
        val useSimpleperf = params?.optBoolean("useSimpleperf", false) ?: false

        Log.d(TAG, "Starting profiling: samplingInterval=$samplingIntervalMs, maxDuration=$maxDurationMs, useSimpleperf=$useSimpleperf")

        val simpleperfAvailable = cpuProfiler.isSimplePerfAvailable()
        Log.d(TAG, "Simpleperf available: $simpleperfAvailable")

        val success = cpuProfiler.start(samplingIntervalMs, maxDurationMs, useSimpleperf)

        if (success) {
            // Send initial status
            sendProfileStatus()

            // Start periodic status updates
            startProfileStatusUpdates(maxDurationMs)
        }

        val profilerType = if (useSimpleperf && cpuProfiler.isSimplePerfAvailable()) "simpleperf" else "java"
        return createResponse(
            success,
            if (success) "Profiling started (interval=${samplingIntervalMs}ms, maxDuration=${maxDurationMs}ms, type=$profilerType)"
            else "Failed to start profiling - session may already be running"
        )
    }

    private suspend fun handleStopProfiling(): JSONObject {
        if (cpuProfiler == null) {
            return createResponse(false, "CPU profiler not initialized")
        }

        // Stop the status update loop
        stopProfileStatusUpdates()

        val session = cpuProfiler.stop()

        return if (session != null) {
            // Send profile data to backend
            sendProfileData(session)
            createResponse(true, "Profiling stopped, ${session.totalSamples} samples collected")
        } else {
            createResponse(false, "No active profiling session")
        }
    }

    private fun handleGetProfileStatus(): JSONObject {
        if (cpuProfiler == null) {
            return createResponse(false, "CPU profiler not initialized")
        }

        val status = cpuProfiler.getStatus()

        return JSONObject().apply {
            put("success", true)
            put("status", JSONObject().apply {
                put("state", status.state)
                put("sessionId", status.sessionId)
                put("sampleCount", status.sampleCount)
                put("elapsedTimeMs", status.elapsedTimeMs)
                put("remainingTimeMs", status.remainingTimeMs)
                put("samplingIntervalMs", status.samplingIntervalMs)
            })
        }
    }

    private fun sendProfileStatus() {
        scope.launch {
            cpuProfiler?.let { profiler ->
                val status = profiler.getStatus()

                val payload = JSONObject().apply {
                    put("deviceId", deviceId)
                    put("status", JSONObject().apply {
                        put("state", status.state)
                        put("sessionId", status.sessionId)
                        put("sampleCount", status.sampleCount)
                        put("elapsedTimeMs", status.elapsedTimeMs)
                        put("remainingTimeMs", status.remainingTimeMs)
                        put("samplingIntervalMs", status.samplingIntervalMs)
                    })
                }

                socket?.emit("profile:status", payload)
                Log.d(TAG, "Sent profile status: state=${status.state}, samples=${status.sampleCount}")
            }
        }
    }

    private fun startProfileStatusUpdates(maxDurationMs: Long) {
        profileStatusJob?.cancel()

        profileStatusJob = scope.launch {
            // Add buffer for simpleperf: recording time + conversion time (up to 90s for large traces)
            val bufferMs = 90000L
            val endTime = System.currentTimeMillis() + maxDurationMs + bufferMs

            while (System.currentTimeMillis() < endTime) {
                delay(PROFILE_STATUS_UPDATE_INTERVAL_MS)

                cpuProfiler?.let { profiler ->
                    val isRunning = profiler.isRunning()
                    val hasCompleted = profiler.hasCompletedSession()

                    // Check if profiling completed naturally (max duration or max samples reached)
                    // hasCompletedSession() returns true when not running but samples exist
                    if (hasCompleted) {
                        Log.d(TAG, "StatusLoop: Profiling completed! isRunning=$isRunning, hasCompleted=$hasCompleted")

                        val session = profiler.stop()
                        if (session != null) {
                            Log.d(TAG, "StatusLoop: Got session with ${session.totalSamples} samples, sending data...")
                            sendProfileData(session)
                            Log.d(TAG, "StatusLoop: Profile data sent, now sending idle status...")
                        } else {
                            Log.e(TAG, "StatusLoop: Failed to get session after completion!")
                        }

                        // Send final idle status
                        sendProfileStatus()
                        Log.d(TAG, "StatusLoop: Idle status sent, exiting loop")
                        return@launch
                    }

                    // Still running - send status update
                    if (isRunning) {
                        sendProfileStatus()
                    }
                }
            }

            // Safety: if we exit the loop and profiling somehow finished without us catching it
            cpuProfiler?.let { profiler ->
                if (profiler.hasCompletedSession()) {
                    Log.d(TAG, "Safety check: found completed session at end of status loop")
                    val session = profiler.stop()
                    if (session != null) {
                        sendProfileData(session)
                    }
                    sendProfileStatus()
                }
            }
        }
    }

    private fun stopProfileStatusUpdates() {
        profileStatusJob?.cancel()
        profileStatusJob = null
    }

    private suspend fun sendProfileData(session: ProfileSession) {
        try {
            // Convert session to JSON using Gson (can be slow for large sessions)
            Log.d(TAG, "sendProfileData: Starting serialization for ${session.totalSamples} samples")
            val sessionJson = gson.toJson(session)
            Log.d(TAG, "sendProfileData: Serialized, size: ${sessionJson.length} chars")

            // Compress the JSON to reduce payload size (18MB -> ~1-2MB typically)
            Log.d(TAG, "sendProfileData: Compressing data...")
            val compressedData = compressString(sessionJson)
            Log.d(TAG, "sendProfileData: Compressed from ${sessionJson.length} to ${compressedData.size} bytes (${(compressedData.size * 100 / sessionJson.length)}%)")

            // Use HTTP POST for large payloads (more reliable than socket.io for big data)
            Log.d(TAG, "sendProfileData: Sending via HTTP POST...")
            val success = sendProfileDataViaHttp(session.sessionId, compressedData)

            if (success) {
                Log.d(TAG, "sendProfileData: HTTP POST successful for sessionId=${session.sessionId}")
            } else {
                Log.e(TAG, "sendProfileData: HTTP POST failed, profile data may be lost")
            }

            // Small delay before sending idle status
            kotlinx.coroutines.delay(200)
            Log.d(TAG, "sendProfileData: Complete")
        } catch (e: Exception) {
            Log.e(TAG, "sendProfileData: ERROR - ${e.message}", e)
        }
    }

    private fun sendProfileDataViaHttp(sessionId: String, compressedData: ByteArray): Boolean {
        return try {
            val url = java.net.URL("$backendUrl/api/profile/upload")
            val connection = url.openConnection() as java.net.HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/octet-stream")
            connection.setRequestProperty("X-Device-Id", deviceId)
            connection.setRequestProperty("X-Session-Id", sessionId)
            connection.setRequestProperty("Content-Encoding", "gzip")
            connection.connectTimeout = 30000
            connection.readTimeout = 30000

            connection.outputStream.use { os ->
                os.write(compressedData)
            }

            val responseCode = connection.responseCode
            Log.d(TAG, "sendProfileDataViaHttp: Response code: $responseCode")

            if (responseCode == 200 || responseCode == 201) {
                true
            } else {
                val errorStream = connection.errorStream?.bufferedReader()?.readText() ?: "Unknown error"
                Log.e(TAG, "sendProfileDataViaHttp: Error response: $errorStream")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "sendProfileDataViaHttp: Exception: ${e.message}", e)
            false
        }
    }

    private fun compressString(input: String): ByteArray {
        val byteArrayOutputStream = java.io.ByteArrayOutputStream()
        java.util.zip.GZIPOutputStream(byteArrayOutputStream).use { gzip ->
            gzip.write(input.toByteArray(Charsets.UTF_8))
        }
        return byteArrayOutputStream.toByteArray()
    }

    private fun getDeviceId(): String {
        val prefs = context.getSharedPreferences("danr_device", Context.MODE_PRIVATE)
        var id = prefs.getString("device_id", null)

        if (id == null) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString("device_id", id).apply()
        }

        return id
    }
}
