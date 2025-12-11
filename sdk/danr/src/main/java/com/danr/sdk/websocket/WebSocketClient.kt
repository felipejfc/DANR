package com.danr.sdk.websocket

import android.content.Context
import android.os.Build
import android.util.Log
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
    private val stressTestManager: StressTestManager
) {
    private var socket: Socket? = null
    private val deviceId = getDeviceId()
    private val gson = Gson()
    private val scope = CoroutineScope(Dispatchers.Default + Job())
    private lateinit var cpuManager: CPUFrequencyManager
    private var autoRestoreJob: Job? = null

    companion object {
        private const val TAG = "WebSocketClient"
        private const val AUTO_RESTORE_TIMEOUT_MS = 60000L // 60 seconds
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
        val duration = params.optLong("duration", 5000L)

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

        val coreId = params.getInt("coreId")
        val enabled = params.getBoolean("enabled")

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
