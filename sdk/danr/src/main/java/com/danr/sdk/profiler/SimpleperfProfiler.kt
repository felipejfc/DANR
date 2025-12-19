package com.danr.sdk.profiler

import android.content.Context
import android.os.Process
import android.util.Base64
import android.util.Log
import com.danr.sdk.shell.RootExecutor
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * Native CPU profiler using simpleperf (requires root).
 * Outputs raw Perfetto-compatible trace files that can be opened in ui.perfetto.dev.
 *
 * The workflow:
 * 1. simpleperf record -p PID -o perf.data
 * 2. simpleperf report-sample --protobuf -i perf.data -o trace.perfetto-trace
 * 3. Send raw trace bytes to backend
 * 4. Backend stores as-is, frontend can download and open in Perfetto
 */
class SimpleperfProfiler(
    private val scope: CoroutineScope,
    private val context: Context
) {

    private var recordingJob: Job? = null
    private var statusJob: Job? = null
    private var currentSessionId: String? = null
    private var startTime: Long = 0
    private var maxDurationMs: Long = 0
    private var samplingIntervalMs: Int = 100
    private var simpleperfPath: String? = null
    private var perfDataFile: String? = null
    private var traceFile: String? = null
    private var targetPid: Int = 0  // PID of the app being profiled

    // Estimated sample count based on elapsed time and frequency
    private var estimatedSamples: Int = 0
    private var recordingComplete: Boolean = false
    private var recordingPhaseComplete: Boolean = false  // Recording done, conversion in progress
    @Volatile private var stopRequested: Boolean = false

    companion object {
        private const val TAG = "SimpleperfProfiler"
        private const val OUTPUT_DIR = "/data/local/tmp"
        private const val SAMPLING_FREQUENCY = 4000  // 4000 Hz for good resolution

        /**
         * Checks if simpleperf profiling is available.
         */
        suspend fun isAvailable(context: Context): Boolean = withContext(Dispatchers.IO) {
            if (!RootExecutor.isRootAvailable()) {
                Log.d(TAG, "Root not available")
                return@withContext false
            }

            val path = SimpleperfInstaller.getOrInstall(context)
            val available = path != null
            Log.d(TAG, "simpleperf available: $available (path: $path)")
            available
        }
    }

    suspend fun start(samplingIntervalMs: Int = 100, maxDurationMs: Long = 60000): Boolean {
        if (isRunning()) {
            Log.w(TAG, "Profiling session already running")
            return false
        }

        simpleperfPath = SimpleperfInstaller.getOrInstall(context)
        if (simpleperfPath == null) {
            Log.e(TAG, "simpleperf not found")
            return false
        }

        this.samplingIntervalMs = samplingIntervalMs
        this.maxDurationMs = maxDurationMs
        this.currentSessionId = UUID.randomUUID().toString()
        this.startTime = System.currentTimeMillis()
        this.estimatedSamples = 0
        this.recordingComplete = false
        this.recordingPhaseComplete = false
        this.stopRequested = false
        this.perfDataFile = "$OUTPUT_DIR/perf_${currentSessionId}.data"
        this.traceFile = "$OUTPUT_DIR/trace_${currentSessionId}.perfetto-trace"

        targetPid = Process.myPid()
        val durationSeconds = maxDurationMs / 1000.0

        Log.d(TAG, "Starting simpleperf recording: pid=$targetPid, duration=${durationSeconds}s, freq=$SAMPLING_FREQUENCY Hz")

        // Start simpleperf record in background
        recordingJob = scope.launch(Dispatchers.IO) {
            // Record with call graphs for proper Perfetto visualization
            // Use --duration so simpleperf runs for the full period (stop will send SIGINT if early)
            val perfPath = simpleperfPath!!
            val recordCmd = "$perfPath record -p $targetPid -o $perfDataFile --duration $durationSeconds -f $SAMPLING_FREQUENCY --call-graph dwarf 2>&1"
            Log.d(TAG, "Recording: $recordCmd")

            val recordResult = RootExecutor.execute(recordCmd, timeoutMs = maxDurationMs + 30000)

            // Check if recording produced a file (even if process was interrupted)
            val fileExists = RootExecutor.executeBlocking("test -s $perfDataFile && echo 'exists'").output.contains("exists")

            if (recordResult.success || fileExists) {
                Log.d(TAG, "Recording completed: ${recordResult.output}, fileExists=$fileExists")
                recordingPhaseComplete = true  // Mark recording done, now converting

                // Convert to Perfetto format with call stacks
                val convertCmd = "$perfPath report-sample --protobuf --show-callchain -i $perfDataFile -o $traceFile 2>&1"
                Log.d(TAG, "Converting: $convertCmd")

                val convertResult = RootExecutor.execute(convertCmd, timeoutMs = 60000)
                if (convertResult.success) {
                    Log.d(TAG, "Conversion completed: ${convertResult.output}")
                    recordingComplete = true
                } else {
                    Log.e(TAG, "Conversion with callchain failed: ${convertResult.error}")
                    // Try simpler conversion without callchain
                    trySimpleConversion(perfPath)
                }
            } else {
                Log.e(TAG, "Recording failed: ${recordResult.error}")
                // Try recording without call graphs
                tryFallbackRecording(targetPid, durationSeconds)
            }
        }

        // Status update job
        statusJob = scope.launch(Dispatchers.IO) {
            while (isActive && isRunning()) {
                val elapsed = System.currentTimeMillis() - startTime
                estimatedSamples = ((elapsed / 1000.0) * SAMPLING_FREQUENCY).toInt()
                delay(500)
            }
        }

        return true
    }

    /**
     * Try a simpler conversion without callchain if the full conversion fails.
     * This preserves the existing perf.data file and just tries a different conversion method.
     */
    private suspend fun trySimpleConversion(perfPath: String) {
        Log.d(TAG, "Trying simple conversion without callchain...")

        val convertCmd = "$perfPath report-sample --protobuf -i $perfDataFile -o $traceFile 2>&1"
        val convertResult = RootExecutor.execute(convertCmd, timeoutMs = 60000)

        if (convertResult.success) {
            Log.d(TAG, "Simple conversion completed")
            recordingComplete = true
        } else {
            Log.e(TAG, "Simple conversion also failed: ${convertResult.error}")
            // Last resort: check if we can at least verify the perf.data file exists
            val statResult = RootExecutor.executeBlocking("stat -c%s $perfDataFile 2>/dev/null")
            if (statResult.success) {
                Log.e(TAG, "perf.data exists (${statResult.output.trim()} bytes) but conversion failed")
            }
        }
    }

    /**
     * Fallback recording without call graphs (dwarf) - only used when initial recording fails.
     */
    private suspend fun tryFallbackRecording(pid: Int, durationSeconds: Double) {
        Log.d(TAG, "Trying fallback recording without call graphs...")

        // Clean up failed attempt
        RootExecutor.execute("rm -f $perfDataFile")

        // Record without call graphs
        val recordCmd = "$simpleperfPath record -p $pid -o $perfDataFile --duration $durationSeconds -f $SAMPLING_FREQUENCY 2>&1"
        val recordResult = RootExecutor.execute(recordCmd, timeoutMs = (durationSeconds * 1000 + 30000).toLong())

        if (recordResult.success) {
            Log.d(TAG, "Fallback recording completed")

            val convertCmd = "$simpleperfPath report-sample --protobuf -i $perfDataFile -o $traceFile 2>&1"
            val convertResult = RootExecutor.execute(convertCmd, timeoutMs = 60000)

            if (convertResult.success) {
                Log.d(TAG, "Fallback conversion completed")
                recordingComplete = true
            } else {
                Log.e(TAG, "Fallback conversion failed: ${convertResult.error}")
            }
        } else {
            Log.e(TAG, "Fallback recording failed: ${recordResult.error}")
        }
    }

    fun stop(): SimpleperfSession? {
        Log.d(TAG, "Stop called, isRunning=${isRunning()}, recordingComplete=$recordingComplete")

        stopRequested = true
        statusJob?.cancel()
        statusJob = null

        val sessionId = currentSessionId ?: return null

        // If recording is still running, send SIGINT to simpleperf to stop it gracefully
        if (recordingJob?.isActive == true) {
            Log.d(TAG, "Sending SIGINT to simpleperf processes for pid $targetPid")
            // Kill simpleperf processes that are recording our PID
            val killResult = RootExecutor.executeBlocking("pkill -SIGINT -f 'simpleperf record -p $targetPid'")
            Log.d(TAG, "pkill result: ${killResult.output} ${killResult.error}")

            // Wait for the recording job to complete (simpleperf will finish writing)
            var waitTime = 0
            while (recordingJob?.isActive == true && waitTime < 15000) {
                Thread.sleep(500)
                waitTime += 500
                Log.d(TAG, "Waiting for simpleperf to finish... ($waitTime ms)")
            }

            if (recordingJob?.isActive == true) {
                Log.w(TAG, "Recording job did not complete in time, cancelling")
                recordingJob?.cancel()
            }
        }

        recordingJob = null

        // Wait a bit more for files to be written
        Thread.sleep(1000)

        // Read raw trace file
        Log.d(TAG, "Reading trace file: $traceFile, recordingComplete=$recordingComplete")
        val traceData = readTraceFile()

        if (traceData == null) {
            Log.e(TAG, "WARNING: traceData is null! Checking file status...")
            val traceExists = RootExecutor.executeBlocking("test -s $traceFile && echo 'exists' || echo 'missing'")
            val perfExists = RootExecutor.executeBlocking("test -s $perfDataFile && echo 'exists' || echo 'missing'")
            Log.e(TAG, "traceFile: ${traceExists.output.trim()}, perfDataFile: ${perfExists.output.trim()}")
        }

        // Cleanup files (delay slightly to ensure read completes)
        scope.launch(Dispatchers.IO) {
            kotlinx.coroutines.delay(1000)
            RootExecutor.execute("rm -f $perfDataFile $traceFile")
        }

        val session = SimpleperfSession(
            sessionId = sessionId,
            startTime = startTime,
            endTime = System.currentTimeMillis(),
            samplingIntervalMs = samplingIntervalMs,
            traceData = traceData,
            profilerType = "simpleperf"
        )

        Log.d(TAG, "Session stopped: traceData size=${traceData?.length ?: 0} chars (${(traceData?.length ?: 0) * 3 / 4} bytes approx)")

        // Reset state
        currentSessionId = null
        startTime = 0
        perfDataFile = null
        traceFile = null
        targetPid = 0
        estimatedSamples = 0
        recordingComplete = false
        recordingPhaseComplete = false
        stopRequested = false

        return session
    }

    private fun readTraceFile(): String? {
        val file = traceFile ?: return null

        // Check file exists and get size
        val statResult = RootExecutor.executeBlocking("stat -c%s $file 2>/dev/null")
        if (!statResult.success) {
            Log.e(TAG, "Trace file not found: $file")
            return null
        }

        val fileSize = statResult.output.trim().toLongOrNull() ?: 0
        Log.d(TAG, "Trace file size: $fileSize bytes")

        if (fileSize == 0L) {
            Log.e(TAG, "Trace file is empty")
            return null
        }

        // Read file and base64 encode
        val readResult = RootExecutor.executeBlocking(
            "base64 $file 2>/dev/null",
            timeoutMs = 60000
        )

        if (!readResult.success) {
            Log.e(TAG, "Failed to read trace file: ${readResult.error}")
            return null
        }

        val base64Data = readResult.output.trim().replace("\n", "")
        Log.d(TAG, "Read trace file: ${base64Data.length} base64 chars")

        return base64Data
    }

    fun isRunning(): Boolean = recordingJob?.isActive == true

    fun hasCompletedSession(): Boolean = recordingComplete && !isRunning()

    fun getStatus(): ProfilerStatus {
        return if (isRunning()) {
            val elapsed = System.currentTimeMillis() - startTime
            val remaining = (maxDurationMs - elapsed).coerceAtLeast(0)

            // Check if we're in conversion phase (recording done, converting trace)
            val state = if (recordingPhaseComplete && !recordingComplete) "converting" else "running"

            ProfilerStatus(
                state = state,
                sessionId = currentSessionId,
                sampleCount = estimatedSamples,
                elapsedTimeMs = elapsed,
                remainingTimeMs = remaining,
                samplingIntervalMs = samplingIntervalMs
            )
        } else {
            ProfilerStatus(state = "idle")
        }
    }
}

/**
 * Simpleperf session containing raw Perfetto trace data.
 */
data class SimpleperfSession(
    @SerializedName("sessionId")
    val sessionId: String,

    @SerializedName("startTime")
    val startTime: Long,

    @SerializedName("endTime")
    val endTime: Long,

    @SerializedName("samplingIntervalMs")
    val samplingIntervalMs: Int,

    @SerializedName("traceData")
    val traceData: String?,  // Base64-encoded raw Perfetto trace

    @SerializedName("profilerType")
    val profilerType: String = "simpleperf"
)
