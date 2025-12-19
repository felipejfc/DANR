package com.danr.sdk.profiler

import android.content.Context
import android.os.Build
import android.util.Log
import com.danr.sdk.shell.RootExecutor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

/**
 * Handles installation of simpleperf binary from app assets to the device.
 * Simpleperf binaries should be placed in assets/simpleperf/ directory:
 * - assets/simpleperf/arm64-v8a/simpleperf
 * - assets/simpleperf/armeabi-v7a/simpleperf
 */
object SimpleperfInstaller {
    private const val TAG = "SimpleperfInstaller"
    private const val SIMPLEPERF_INSTALL_PATH = "/data/local/tmp/simpleperf"

    // System paths where simpleperf might already exist
    private val SYSTEM_PATHS = listOf(
        "/system/bin/simpleperf",
        "/system/xbin/simpleperf"
    )

    /**
     * Gets the path to a working simpleperf binary.
     * First checks system paths, then tries to install from assets if needed.
     *
     * @param context Application context for accessing assets
     * @return Path to simpleperf binary, or null if not available
     */
    suspend fun getOrInstall(context: Context): String? = withContext(Dispatchers.IO) {
        Log.d(TAG, "getOrInstall: checking for simpleperf...")

        // First check if simpleperf exists in system paths
        for (systemPath in SYSTEM_PATHS) {
            Log.d(TAG, "Checking system path: $systemPath")
            if (checkBinaryExists(systemPath)) {
                Log.d(TAG, "Found simpleperf at system path: $systemPath")
                return@withContext systemPath
            }
        }

        // Check if we already installed it
        Log.d(TAG, "Checking install path: $SIMPLEPERF_INSTALL_PATH")
        if (checkBinaryExists(SIMPLEPERF_INSTALL_PATH)) {
            Log.d(TAG, "Found previously installed simpleperf at: $SIMPLEPERF_INSTALL_PATH")
            return@withContext SIMPLEPERF_INSTALL_PATH
        }

        // Try to install from assets
        Log.d(TAG, "Simpleperf not found, attempting to install from assets...")
        if (installFromAssets(context)) {
            Log.d(TAG, "Successfully installed simpleperf to: $SIMPLEPERF_INSTALL_PATH")
            return@withContext SIMPLEPERF_INSTALL_PATH
        }

        Log.w(TAG, "Failed to find or install simpleperf")
        null
    }

    /**
     * Checks if simpleperf binary exists and is executable at the given path.
     */
    private suspend fun checkBinaryExists(path: String): Boolean {
        val result = RootExecutor.execute("test -x $path && echo 'exists'")
        return result.success && result.output.contains("exists")
    }

    /**
     * Installs simpleperf from app assets to /data/local/tmp.
     */
    private suspend fun installFromAssets(context: Context): Boolean {
        val abi = getDeviceAbi()
        Log.d(TAG, "Device ABI: $abi")

        val assetPath = "simpleperf/$abi/simpleperf"

        try {
            // Check if asset exists
            val assetFiles = context.assets.list("simpleperf/$abi")
            if (assetFiles == null || !assetFiles.contains("simpleperf")) {
                Log.e(TAG, "Simpleperf binary not found in assets for ABI: $abi")
                Log.e(TAG, "Please add simpleperf binary to: assets/$assetPath")
                return false
            }

            // Extract to app's private directory first
            val tempFile = File(context.cacheDir, "simpleperf_temp")
            context.assets.open(assetPath).use { input ->
                FileOutputStream(tempFile).use { output ->
                    input.copyTo(output)
                }
            }

            Log.d(TAG, "Extracted simpleperf to temp: ${tempFile.absolutePath} (${tempFile.length()} bytes)")

            // Copy to /data/local/tmp using root
            val copyResult = RootExecutor.execute(
                "cp ${tempFile.absolutePath} $SIMPLEPERF_INSTALL_PATH && chmod 755 $SIMPLEPERF_INSTALL_PATH"
            )

            // Clean up temp file
            tempFile.delete()

            if (!copyResult.success) {
                Log.e(TAG, "Failed to copy simpleperf: ${copyResult.error}")
                return false
            }

            // Verify installation
            val verifyResult = RootExecutor.execute("$SIMPLEPERF_INSTALL_PATH --version 2>&1 | head -1")
            if (verifyResult.success) {
                Log.d(TAG, "Simpleperf installed successfully: ${verifyResult.output.trim()}")
                return true
            } else {
                Log.e(TAG, "Simpleperf verification failed: ${verifyResult.error}")
                return false
            }

        } catch (e: Exception) {
            Log.e(TAG, "Failed to install simpleperf from assets", e)
            return false
        }
    }

    /**
     * Gets the primary ABI for the device.
     */
    private fun getDeviceAbi(): String {
        val supportedAbis = Build.SUPPORTED_ABIS

        // Prefer 64-bit if available
        for (abi in supportedAbis) {
            if (abi == "arm64-v8a" || abi == "x86_64") {
                return abi
            }
        }

        // Fall back to first supported ABI
        return supportedAbis.firstOrNull() ?: "arm64-v8a"
    }

    /**
     * Checks if simpleperf is available (either installed or can be installed).
     */
    suspend fun isAvailable(context: Context): Boolean {
        return getOrInstall(context) != null
    }
}
