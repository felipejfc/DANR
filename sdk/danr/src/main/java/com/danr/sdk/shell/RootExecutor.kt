package com.danr.sdk.shell

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.BufferedReader
import java.io.DataOutputStream
import java.io.InputStreamReader

data class CommandResult(
    val success: Boolean,
    val output: String,
    val error: String = ""
)

object RootExecutor {
    private const val TAG = "RootExecutor"
    private const val DEFAULT_TIMEOUT_MS = 10000L

    @Volatile
    private var hasRoot: Boolean? = null

    suspend fun isRootAvailable(): Boolean {
        if (hasRoot != null) return hasRoot!!

        hasRoot = withContext(Dispatchers.IO) {
            try {
                val result = execute("id")
                result.success && result.output.contains("uid=0")
            } catch (e: Exception) {
                Log.e(TAG, "Error checking root", e)
                false
            }
        }

        Log.d(TAG, "Root available: $hasRoot")
        return hasRoot!!
    }

    suspend fun execute(
        command: String,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS
    ): CommandResult = withContext(Dispatchers.IO) {
        try {
            withTimeout(timeoutMs) {
                executeCommand(command)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Command execution failed: $command", e)
            CommandResult(
                success = false,
                output = "",
                error = e.message ?: "Unknown error"
            )
        }
    }

    /**
     * Blocking version of execute for use outside of coroutines.
     * Use with caution - this will block the calling thread.
     */
    fun executeBlocking(
        command: String,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS
    ): CommandResult {
        return try {
            executeCommand(command)
        } catch (e: Exception) {
            Log.e(TAG, "Command execution failed: $command", e)
            CommandResult(
                success = false,
                output = "",
                error = e.message ?: "Unknown error"
            )
        }
    }

    private fun executeCommand(command: String): CommandResult {
        var process: Process? = null
        var dataOutputStream: DataOutputStream? = null
        var successReader: BufferedReader? = null
        var errorReader: BufferedReader? = null

        try {
            process = Runtime.getRuntime().exec("su")
            dataOutputStream = DataOutputStream(process.outputStream)

            dataOutputStream.writeBytes("$command\n")
            dataOutputStream.writeBytes("exit\n")
            dataOutputStream.flush()

            successReader = BufferedReader(InputStreamReader(process.inputStream))
            errorReader = BufferedReader(InputStreamReader(process.errorStream))

            val output = successReader.readText()
            val error = errorReader.readText()

            val exitCode = process.waitFor()

            return CommandResult(
                success = exitCode == 0,
                output = output,
                error = error
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error executing command: $command", e)
            return CommandResult(
                success = false,
                output = "",
                error = e.message ?: "Unknown error"
            )
        } finally {
            try {
                dataOutputStream?.close()
                successReader?.close()
                errorReader?.close()
                process?.destroy()
            } catch (e: Exception) {
                Log.e(TAG, "Error closing streams", e)
            }
        }
    }
}
