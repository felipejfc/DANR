package com.danr.sdk.triggers

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.net.Socket
import kotlin.random.Random

object ANRTriggers {
    private const val TAG = "ANRTriggers"

    fun triggerInfiniteLoop(durationMs: Long) {
        Handler(Looper.getMainLooper()).post {
            Log.d(TAG, "Triggering infinite loop for ${durationMs}ms")
            val endTime = System.currentTimeMillis() + durationMs
            while (System.currentTimeMillis() < endTime) {
                // Busy loop on main thread
            }
            Log.d(TAG, "Infinite loop completed")
        }
    }

    fun triggerSleep(durationMs: Long) {
        Handler(Looper.getMainLooper()).post {
            Log.d(TAG, "Triggering sleep for ${durationMs}ms")
            try {
                Thread.sleep(durationMs)
            } catch (e: InterruptedException) {
                Log.e(TAG, "Sleep interrupted", e)
            }
            Log.d(TAG, "Sleep completed")
        }
    }

    fun triggerHeavyComputation(durationMs: Long) {
        Handler(Looper.getMainLooper()).post {
            Log.d(TAG, "Triggering heavy computation")
            val endTime = System.currentTimeMillis() + durationMs

            while (System.currentTimeMillis() < endTime) {
                // CPU intensive operations
                var result = 0.0
                for (i in 0..10000) {
                    result += Math.sqrt(i.toDouble()) * Math.sin(i.toDouble())
                }
            }
            Log.d(TAG, "Heavy computation completed")
        }
    }

    fun triggerMemoryStress(allocationSizeMB: Int, durationMs: Long) {
        Handler(Looper.getMainLooper()).post {
            Log.d(TAG, "Triggering memory stress: ${allocationSizeMB}MB for ${durationMs}ms")
            try {
                val endTime = System.currentTimeMillis() + durationMs
                val arrays = mutableListOf<ByteArray>()

                while (System.currentTimeMillis() < endTime) {
                    // Allocate 1MB chunks
                    val chunk = ByteArray(1024 * 1024)
                    arrays.add(chunk)

                    if (arrays.size >= allocationSizeMB) {
                        // Clear and restart
                        arrays.clear()
                    }

                    // Small delay to prevent immediate OOM
                    Thread.sleep(10)
                }

                arrays.clear()
                Log.d(TAG, "Memory stress completed")
            } catch (e: Exception) {
                Log.e(TAG, "Memory stress error", e)
            }
        }
    }

    fun triggerDiskIO(durationMs: Long, tempDir: File) {
        Handler(Looper.getMainLooper()).post {
            Log.d(TAG, "Triggering disk I/O for ${durationMs}ms")
            try {
                val endTime = System.currentTimeMillis() + durationMs
                val testFile = File(tempDir, "danr_test_${System.currentTimeMillis()}.tmp")

                while (System.currentTimeMillis() < endTime) {
                    // Write operations
                    FileOutputStream(testFile).use { output ->
                        val data = ByteArray(1024 * 100) // 100KB
                        Random.nextBytes(data)
                        output.write(data)
                        output.flush()
                    }

                    // Read operations
                    testFile.readBytes()

                    // Delete and recreate
                    testFile.delete()
                }

                testFile.delete()
                Log.d(TAG, "Disk I/O completed")
            } catch (e: Exception) {
                Log.e(TAG, "Disk I/O error", e)
            }
        }
    }

    fun triggerSynchronousNetwork(timeoutMs: Int) {
        Handler(Looper.getMainLooper()).post {
            Log.d(TAG, "Triggering synchronous network call")
            try {
                // Attempt to connect to a non-existent server with timeout
                val socket = Socket()
                socket.connect(
                    java.net.InetSocketAddress("192.0.2.0", 80), // TEST-NET-1 (non-routable)
                    timeoutMs
                )
                socket.close()
            } catch (e: Exception) {
                // Expected to timeout
                Log.d(TAG, "Network call timed out as expected")
            }
        }
    }
}
