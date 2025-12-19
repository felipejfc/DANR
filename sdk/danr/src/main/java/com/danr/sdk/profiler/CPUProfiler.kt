package com.danr.sdk.profiler

import android.os.Looper
import android.os.Process
import android.util.Log
import com.danr.sdk.collectors.ThreadInfoCollector
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue

// Data classes for profiling

data class ThreadCPUTime(
    @SerializedName("userTimeJiffies")
    val userTimeJiffies: Long,

    @SerializedName("kernelTimeJiffies")
    val kernelTimeJiffies: Long,

    @SerializedName("cpuUsagePercent")
    val cpuUsagePercent: Float? = null
)

data class SystemCPUInfo(
    @SerializedName("userPercent")
    val userPercent: Float,

    @SerializedName("systemPercent")
    val systemPercent: Float,

    @SerializedName("iowaitPercent")
    val iowaitPercent: Float
)

data class ThreadSnapshot(
    @SerializedName("threadId")
    val threadId: Long,

    @SerializedName("threadName")
    val threadName: String,

    @SerializedName("state")
    val state: String,

    @SerializedName("stackFrames")
    val stackFrames: List<String>,

    @SerializedName("isMainThread")
    val isMainThread: Boolean,

    @SerializedName("cpuTime")
    val cpuTime: ThreadCPUTime? = null
)

data class ProfileSample(
    @SerializedName("timestamp")
    val timestamp: Long,

    @SerializedName("threads")
    val threads: List<ThreadSnapshot>,

    @SerializedName("systemCPU")
    val systemCPU: SystemCPUInfo? = null
)

data class ProfileSession(
    @SerializedName("sessionId")
    val sessionId: String,

    @SerializedName("startTime")
    val startTime: Long,

    @SerializedName("endTime")
    val endTime: Long,

    @SerializedName("samplingIntervalMs")
    val samplingIntervalMs: Int,

    @SerializedName("samples")
    val samples: List<ProfileSample>,

    @SerializedName("hasRoot")
    val hasRoot: Boolean,

    @SerializedName("totalSamples")
    val totalSamples: Int = samples.size,

    @SerializedName("profilerType")
    val profilerType: String = "java",

    @SerializedName("traceData")
    val traceData: String? = null  // Base64-encoded raw Perfetto trace for simpleperf
)

data class ProfilerStatus(
    @SerializedName("state")
    val state: String,  // "idle", "running", "stopped"

    @SerializedName("sessionId")
    val sessionId: String? = null,

    @SerializedName("sampleCount")
    val sampleCount: Int = 0,

    @SerializedName("elapsedTimeMs")
    val elapsedTimeMs: Long = 0,

    @SerializedName("remainingTimeMs")
    val remainingTimeMs: Long = 0,

    @SerializedName("samplingIntervalMs")
    val samplingIntervalMs: Int = 0
)

class CPUProfiler(
    private val scope: CoroutineScope,
    private val threadInfoCollector: ThreadInfoCollector,
    private val context: android.content.Context
) {
    private var profilingJob: Job? = null
    private var currentSessionId: String? = null
    private var startTime: Long = 0
    private var maxDurationMs: Long = 0
    private var samplingIntervalMs: Int = 50
    private var hasRoot: Boolean = false

    private val samples = ConcurrentLinkedQueue<ProfileSample>()
    private val procStatReader = ProcStatReader()

    // Simpleperf profiler for native profiling (when root is available)
    private var simpleperfProfiler: SimpleperfProfiler? = null
    private var useSimpleperf: Boolean = false

    // Track previous CPU times for delta calculation
    private var previousThreadCPUTimes: Map<Long, ThreadCPUTime> = emptyMap()
    private var previousSampleTime: Long = 0

    companion object {
        private const val TAG = "CPUProfiler"
        private const val MAX_SAMPLES = 2400  // 2 minutes at 50ms = 2400 samples
        private const val MAX_STACK_FRAMES = 30  // Limit stack depth to reduce payload size
    }

    suspend fun isSimplePerfAvailable(): Boolean = SimpleperfProfiler.isAvailable(context)

    suspend fun start(samplingIntervalMs: Int = 50, maxDurationMs: Long = 60000, useSimpleperf: Boolean = false): Boolean {
        if (isRunning()) {
            Log.w(TAG, "Profiling session already running")
            return false
        }

        this.samplingIntervalMs = samplingIntervalMs
        this.maxDurationMs = maxDurationMs
        this.useSimpleperf = useSimpleperf

        // Try to use simpleperf if requested and available
        if (useSimpleperf && SimpleperfProfiler.isAvailable(context)) {
            Log.d(TAG, "Using simpleperf profiler (root available)")
            simpleperfProfiler = SimpleperfProfiler(scope, context)
            return simpleperfProfiler!!.start(samplingIntervalMs, maxDurationMs)
        }

        // Fall back to Java-based profiling
        this.currentSessionId = UUID.randomUUID().toString()
        this.startTime = System.currentTimeMillis()
        this.samples.clear()
        this.previousThreadCPUTimes = emptyMap()
        this.previousSampleTime = 0

        // Check if we can read /proc files (usually yes for own process)
        val canReadProc = try {
            val taskDir = java.io.File("/proc/${Process.myPid()}/task")
            taskDir.exists() && taskDir.canRead()
        } catch (e: Exception) {
            false
        }
        hasRoot = canReadProc

        Log.d(TAG, "Starting CPU profiling: interval=${samplingIntervalMs}ms, maxDuration=${maxDurationMs}ms, canReadProc=$canReadProc, useSimpleperf=false")

        profilingJob = scope.launch(Dispatchers.Default) {
            val endTime = System.currentTimeMillis() + maxDurationMs

            while (isActive && System.currentTimeMillis() < endTime && samples.size < MAX_SAMPLES) {
                try {
                    val sample = collectSample()
                    samples.add(sample)

                    if (samples.size % 100 == 0) {
                        Log.d(TAG, "Collected ${samples.size} samples")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error collecting sample", e)
                }

                delay(samplingIntervalMs.toLong())
            }

            Log.d(TAG, "Profiling completed: ${samples.size} samples collected")
        }

        return true
    }

    fun stop(): ProfileSession? {
        // Handle simpleperf session
        if (simpleperfProfiler != null) {
            val simpleperfSession = simpleperfProfiler!!.stop()
            simpleperfProfiler = null
            useSimpleperf = false

            if (simpleperfSession == null) {
                return null
            }

            // Convert SimpleperfSession to ProfileSession with raw trace data
            return ProfileSession(
                sessionId = simpleperfSession.sessionId,
                startTime = simpleperfSession.startTime,
                endTime = simpleperfSession.endTime,
                samplingIntervalMs = simpleperfSession.samplingIntervalMs,
                samples = emptyList(),  // No parsed samples for simpleperf - we use raw trace
                hasRoot = true,
                profilerType = "simpleperf",
                traceData = simpleperfSession.traceData  // Raw Perfetto trace (base64)
            )
        }

        // Handle Java-based profiling session
        if (!isRunning() && samples.isEmpty()) {
            Log.w(TAG, "No active profiling session and no samples to collect")
            return null
        }

        profilingJob?.cancel()
        profilingJob = null

        val session = ProfileSession(
            sessionId = currentSessionId ?: UUID.randomUUID().toString(),
            startTime = startTime,
            endTime = System.currentTimeMillis(),
            samplingIntervalMs = samplingIntervalMs,
            samples = samples.toList(),
            hasRoot = hasRoot
        )

        Log.d(TAG, "Profiling session stopped: ${session.totalSamples} samples, duration=${session.endTime - session.startTime}ms")

        // Reset state
        currentSessionId = null
        startTime = 0
        samples.clear()
        previousThreadCPUTimes = emptyMap()

        return session
    }

    fun isRunning(): Boolean {
        if (simpleperfProfiler?.isRunning() == true) return true
        return profilingJob?.isActive == true
    }

    fun hasCompletedSession(): Boolean {
        if (simpleperfProfiler?.hasCompletedSession() == true) return true
        return !isRunning() && samples.isNotEmpty()
    }

    fun getStatus(): ProfilerStatus {
        // Check simpleperf profiler first
        simpleperfProfiler?.let {
            return it.getStatus()
        }

        return if (isRunning()) {
            val elapsed = System.currentTimeMillis() - startTime
            val remaining = (maxDurationMs - elapsed).coerceAtLeast(0)

            ProfilerStatus(
                state = "running",
                sessionId = currentSessionId,
                sampleCount = samples.size,
                elapsedTimeMs = elapsed,
                remainingTimeMs = remaining,
                samplingIntervalMs = samplingIntervalMs
            )
        } else {
            ProfilerStatus(state = "idle")
        }
    }

    private fun collectSample(): ProfileSample {
        val currentTime = System.currentTimeMillis()
        val pid = Process.myPid()
        val mainThread = Looper.getMainLooper().thread

        // Collect thread stack traces
        val threadTraces = Thread.getAllStackTraces()

        // Get CPU times - now uses direct file I/O, no root needed for own process
        val threadCPUTimes = procStatReader.getAllThreadsCPUTime(pid)

        // Calculate CPU usage percentages from deltas
        val timeDeltaMs = if (previousSampleTime > 0) currentTime - previousSampleTime else samplingIntervalMs.toLong()
        val jiffiesPerSecond = 100L  // Standard Linux HZ value

        val threads = threadTraces.map { (thread, stackTrace) ->
            val cpuTime = threadCPUTimes[thread.id]
            val cpuTimeWithPercent = if (cpuTime != null && previousThreadCPUTimes.containsKey(thread.id)) {
                val prevCpuTime = previousThreadCPUTimes[thread.id]!!
                val userDelta = cpuTime.userTimeJiffies - prevCpuTime.userTimeJiffies
                val kernelDelta = cpuTime.kernelTimeJiffies - prevCpuTime.kernelTimeJiffies
                val totalDelta = userDelta + kernelDelta

                // Convert jiffies to percentage: (jiffies / (time_ms * HZ / 1000)) * 100
                val cpuPercent = if (timeDeltaMs > 0) {
                    (totalDelta.toFloat() / (timeDeltaMs * jiffiesPerSecond / 1000)) * 100
                } else {
                    0f
                }

                cpuTime.copy(cpuUsagePercent = cpuPercent.coerceIn(0f, 100f))
            } else {
                cpuTime
            }

            ThreadSnapshot(
                threadId = thread.id,
                threadName = thread.name,
                state = thread.state.name,
                stackFrames = stackTrace.take(MAX_STACK_FRAMES).map { it.toString() },
                isMainThread = thread == mainThread,
                cpuTime = cpuTimeWithPercent
            )
        }

        // Get system CPU info - now uses direct file I/O
        val systemCPU = procStatReader.getSystemCPUInfo()

        // Update previous values for next delta calculation
        previousThreadCPUTimes = threadCPUTimes
        previousSampleTime = currentTime

        return ProfileSample(
            timestamp = currentTime,
            threads = threads,
            systemCPU = systemCPU
        )
    }
}
