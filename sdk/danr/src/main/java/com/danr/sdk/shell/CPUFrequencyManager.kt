package com.danr.sdk.shell

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class CPUInfo(
    val cores: Int,
    val currentMaxFreq: Int,
    val originalMaxFreq: Int,
    val availableFreqs: List<Int>
)

class CPUFrequencyManager(context: Context) {
    private val TAG = "CPUFrequencyManager"
    private val prefs: SharedPreferences =
        context.getSharedPreferences("danr_cpu_settings", Context.MODE_PRIVATE)

    private val CPU_PATH = "/sys/devices/system/cpu"

    suspend fun getCPUInfo(): CPUInfo? = withContext(Dispatchers.IO) {
        try {
            val cores = getCoreCount()
            val currentMaxFreq = getCurrentMaxFrequency(0)
            val originalMaxFreq = getOriginalMaxFrequency() ?: currentMaxFreq
            val availableFreqs = getAvailableFrequencies(0)

            CPUInfo(
                cores = cores,
                currentMaxFreq = currentMaxFreq,
                originalMaxFreq = originalMaxFreq,
                availableFreqs = availableFreqs
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error getting CPU info", e)
            null
        }
    }

    private suspend fun getCoreCount(): Int {
        val result = RootExecutor.execute("ls -d $CPU_PATH/cpu[0-9]* | wc -l")
        return if (result.success) {
            result.output.trim().toIntOrNull() ?: 1
        } else {
            1
        }
    }

    private suspend fun getCurrentMaxFrequency(core: Int): Int {
        val result = RootExecutor.execute("cat $CPU_PATH/cpu$core/cpufreq/scaling_max_freq")
        return if (result.success) {
            result.output.trim().toIntOrNull() ?: 0
        } else {
            0
        }
    }

    private suspend fun getAvailableFrequencies(core: Int): List<Int> {
        val result = RootExecutor.execute("cat $CPU_PATH/cpu$core/cpufreq/scaling_available_frequencies")
        return if (result.success) {
            result.output.trim()
                .split("\\s+".toRegex())
                .mapNotNull { it.toIntOrNull() }
                .sorted()
        } else {
            emptyList()
        }
    }

    suspend fun setMaxFrequency(frequency: Int, cores: List<Int>? = null): Boolean {
        // Save original frequency before first modification
        if (getOriginalMaxFrequency() == null) {
            val currentFreq = getCurrentMaxFrequency(0)
            saveOriginalMaxFrequency(currentFreq)
        }

        val coreCount = getCoreCount()
        val targetCores = cores ?: (0 until coreCount).toList()

        var allSuccessful = true

        for (core in targetCores) {
            val result = RootExecutor.execute(
                "echo $frequency > $CPU_PATH/cpu$core/cpufreq/scaling_max_freq"
            )

            if (!result.success) {
                Log.e(TAG, "Failed to set frequency for core $core: ${result.error}")
                allSuccessful = false
            }
        }

        return allSuccessful
    }

    suspend fun restoreOriginalFrequency(): Boolean {
        val originalFreq = getOriginalMaxFrequency() ?: return false

        Log.d(TAG, "Restoring original frequency: $originalFreq")

        val success = setMaxFrequency(originalFreq)

        if (success) {
            clearOriginalMaxFrequency()
        }

        return success
    }

    private fun saveOriginalMaxFrequency(frequency: Int) {
        prefs.edit().putInt("original_max_freq", frequency).apply()
        Log.d(TAG, "Saved original frequency: $frequency")
    }

    private fun getOriginalMaxFrequency(): Int? {
        val freq = prefs.getInt("original_max_freq", -1)
        return if (freq > 0) freq else null
    }

    private fun clearOriginalMaxFrequency() {
        prefs.edit().remove("original_max_freq").apply()
    }

    suspend fun toggleCore(coreId: Int, enabled: Boolean): Boolean {
        if (coreId == 0) {
            Log.w(TAG, "Cannot disable core 0")
            return false
        }

        val value = if (enabled) "1" else "0"
        val result = RootExecutor.execute("echo $value > $CPU_PATH/cpu$coreId/online")

        return result.success
    }

    suspend fun getCoreStatus(): Map<Int, Boolean> {
        val coreCount = getCoreCount()
        val status = mutableMapOf<Int, Boolean>()

        for (i in 0 until coreCount) {
            val result = RootExecutor.execute("cat $CPU_PATH/cpu$i/online")
            status[i] = result.success && result.output.trim() == "1"
        }

        return status
    }
}
