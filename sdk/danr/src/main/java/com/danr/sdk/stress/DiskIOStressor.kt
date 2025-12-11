package com.danr.sdk.stress

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.random.Random

class DiskIOStressor(
    private val context: Context,
    private val scope: CoroutineScope
) {
    private var stressJob: Job? = null
    private var startTime: Long = 0
    private var durationMs: Long = 0
    private var totalBytesWritten: Long = 0
    private var totalBytesRead: Long = 0

    companion object {
        private const val TAG = "DiskIOStressor"
        private const val CHUNK_SIZE_KB = 100
    }

    fun start(throughputMBps: Int = 5, duration: Long = 300000) {
        if (isRunning()) {
            Log.w(TAG, "Disk I/O stress test already running")
            return
        }

        startTime = System.currentTimeMillis()
        durationMs = duration
        totalBytesWritten = 0
        totalBytesRead = 0

        Log.d(TAG, "Starting disk I/O stress: ${throughputMBps}MB/s for ${duration / 1000}s")

        stressJob = scope.launch(Dispatchers.IO) {
            try {
                val testDir = File(context.cacheDir, "stress_test")
                testDir.mkdirs()

                val endTime = System.currentTimeMillis() + duration
                val chunkSizeBytes = CHUNK_SIZE_KB * 1024
                val data = ByteArray(chunkSizeBytes) { Random.nextInt(256).toByte() }

                // Calculate delay between writes to achieve target throughput
                val delayMs = (chunkSizeBytes.toDouble() / (throughputMBps * 1024 * 1024) * 1000).toLong()

                var fileCounter = 0
                while (isActive && System.currentTimeMillis() < endTime) {
                    val file = File(testDir, "stress_$fileCounter.tmp")

                    // Write data
                    file.outputStream().use { output ->
                        for (i in 0 until 10) { // Write 10 chunks per file (1MB)
                            if (!isActive) break
                            output.write(data)
                            totalBytesWritten += chunkSizeBytes
                        }
                    }

                    // Read data back
                    file.inputStream().use { input ->
                        val buffer = ByteArray(chunkSizeBytes)
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            if (!isActive) break
                            totalBytesRead += bytesRead
                        }
                    }

                    // Delete file
                    file.delete()

                    fileCounter++

                    // Throttle to achieve target throughput
                    if (delayMs > 0) {
                        delay(delayMs)
                    }
                }

                Log.d(TAG, "Disk I/O stress completed: ${totalBytesWritten / 1024 / 1024}MB written, ${totalBytesRead / 1024 / 1024}MB read")
            } finally {
                cleanup()
            }
        }
    }

    fun stop() {
        stressJob?.cancel()
        stressJob = null
        cleanup()
        Log.d(TAG, "Disk I/O stress test stopped")
    }

    private fun cleanup() {
        val testDir = File(context.cacheDir, "stress_test")
        if (testDir.exists()) {
            testDir.listFiles()?.forEach { it.delete() }
            testDir.delete()
        }
    }

    fun isRunning(): Boolean = stressJob?.isActive ?: false

    fun getRemainingTime(): Long {
        if (!isRunning()) return 0
        val elapsed = System.currentTimeMillis() - startTime
        return (durationMs - elapsed).coerceAtLeast(0)
    }

    fun getStatus(): StressStatus {
        return StressStatus(
            type = "disk_io",
            isRunning = isRunning(),
            remainingTimeMs = getRemainingTime(),
            data = mapOf(
                "bytesWrittenMB" to (totalBytesWritten / 1024 / 1024),
                "bytesReadMB" to (totalBytesRead / 1024 / 1024)
            )
        )
    }
}
