package com.danr.sdk.profiler

import android.os.Process
import android.util.Log
import java.io.File

/**
 * Reads CPU time information from /proc filesystem.
 * Uses direct file I/O for performance (shell commands are too slow for profiling).
 *
 * /proc/<pid>/task/<tid>/stat format (space-separated):
 * Field 14 (index 13): utime - CPU time in user mode (jiffies)
 * Field 15 (index 14): stime - CPU time in kernel mode (jiffies)
 *
 * /proc/stat format for system CPU:
 * cpu  user nice system idle iowait irq softirq steal guest guest_nice
 */
class ProcStatReader {

    companion object {
        private const val TAG = "ProcStatReader"
    }

    // Store previous system CPU values for delta calculation
    private var prevSystemCPU: LongArray? = null
    private var prevSystemTime: Long = 0

    /**
     * Get CPU time for a specific thread using direct file I/O.
     *
     * @param pid Process ID
     * @param tid Thread ID
     * @return ThreadCPUTime or null if unable to read
     */
    fun getThreadCPUTime(pid: Int, tid: Long): ThreadCPUTime? {
        return try {
            val statFile = File("/proc/$pid/task/$tid/stat")
            if (!statFile.exists() || !statFile.canRead()) {
                return null
            }
            val stat = statFile.readText()
            parseThreadStat(stat)
        } catch (e: Exception) {
            // Don't log every failure - threads can disappear
            null
        }
    }

    /**
     * Get CPU times for all threads of a process using direct file I/O.
     * Much faster than shell commands.
     *
     * @param pid Process ID
     * @return Map of thread ID to ThreadCPUTime
     */
    fun getAllThreadsCPUTime(pid: Int): Map<Long, ThreadCPUTime> {
        return try {
            val taskDir = File("/proc/$pid/task")
            if (!taskDir.exists() || !taskDir.isDirectory) {
                return emptyMap()
            }

            val threadCPUTimes = mutableMapOf<Long, ThreadCPUTime>()

            taskDir.listFiles()?.forEach { tidDir ->
                try {
                    val tid = tidDir.name.toLongOrNull() ?: return@forEach
                    val statFile = File(tidDir, "stat")
                    if (statFile.exists() && statFile.canRead()) {
                        val stat = statFile.readText()
                        val cpuTime = parseThreadStat(stat)
                        if (cpuTime != null) {
                            threadCPUTimes[tid] = cpuTime
                        }
                    }
                } catch (e: Exception) {
                    // Thread may have disappeared, ignore
                }
            }

            threadCPUTimes
        } catch (e: Exception) {
            Log.e(TAG, "Error reading all thread CPU times for pid=$pid", e)
            emptyMap()
        }
    }

    /**
     * Get system-wide CPU information from /proc/stat.
     *
     * @return SystemCPUInfo or null if unable to read
     */
    fun getSystemCPUInfo(): SystemCPUInfo? {
        return try {
            val statFile = File("/proc/stat")
            if (!statFile.exists() || !statFile.canRead()) {
                return null
            }

            // Read just the first line
            val firstLine = statFile.bufferedReader().use { it.readLine() }
            parseSystemStat(firstLine)
        } catch (e: Exception) {
            Log.e(TAG, "Error reading system CPU info", e)
            null
        }
    }

    /**
     * Parse /proc/<pid>/task/<tid>/stat output.
     *
     * The format is tricky because the process name (field 2) can contain spaces and parentheses.
     * Format: pid (comm) state ppid pgrp session tty_nr tpgid flags minflt cminflt majflt cmajflt utime stime ...
     *
     * We need fields 14 (utime) and 15 (stime) - 0-indexed: 13 and 14
     */
    private fun parseThreadStat(stat: String): ThreadCPUTime? {
        try {
            // Find the closing parenthesis of the comm field
            val commEnd = stat.lastIndexOf(')')
            if (commEnd == -1) return null

            // Fields after comm start after ") "
            val fieldsAfterComm = stat.substring(commEnd + 2).split(" ")

            // fieldsAfterComm[0] is state (field 3)
            // We need utime (field 14) and stime (field 15)
            // In fieldsAfterComm: utime is index 11, stime is index 12
            if (fieldsAfterComm.size < 13) return null

            val utime = fieldsAfterComm[11].toLongOrNull() ?: return null
            val stime = fieldsAfterComm[12].toLongOrNull() ?: return null

            return ThreadCPUTime(
                userTimeJiffies = utime,
                kernelTimeJiffies = stime,
                cpuUsagePercent = null
            )
        } catch (e: Exception) {
            return null
        }
    }

    /**
     * Parse /proc/stat first line for system CPU usage.
     *
     * Format: cpu  user nice system idle iowait irq softirq steal guest guest_nice
     * We calculate percentages based on delta from previous read.
     */
    private fun parseSystemStat(stat: String): SystemCPUInfo? {
        try {
            val parts = stat.trim().split("\\s+".toRegex())
            if (parts.size < 8 || parts[0] != "cpu") return null

            val user = parts[1].toLongOrNull() ?: return null
            val nice = parts[2].toLongOrNull() ?: return null
            val system = parts[3].toLongOrNull() ?: return null
            val idle = parts[4].toLongOrNull() ?: return null
            val iowait = parts[5].toLongOrNull() ?: return null
            val irq = parts[6].toLongOrNull() ?: return null
            val softirq = parts[7].toLongOrNull() ?: return null

            val currentValues = longArrayOf(user, nice, system, idle, iowait, irq, softirq)
            val currentTime = System.currentTimeMillis()

            val result = if (prevSystemCPU != null) {
                val prev = prevSystemCPU!!

                val userDelta = (user + nice) - (prev[0] + prev[1])
                val systemDelta = (system + irq + softirq) - (prev[2] + prev[5] + prev[6])
                val idleDelta = idle - prev[3]
                val iowaitDelta = iowait - prev[4]

                val totalDelta = userDelta + systemDelta + idleDelta + iowaitDelta

                if (totalDelta > 0) {
                    SystemCPUInfo(
                        userPercent = (userDelta.toFloat() / totalDelta) * 100,
                        systemPercent = (systemDelta.toFloat() / totalDelta) * 100,
                        iowaitPercent = (iowaitDelta.toFloat() / totalDelta) * 100
                    )
                } else {
                    SystemCPUInfo(0f, 0f, 0f)
                }
            } else {
                // First read, return zeros
                SystemCPUInfo(0f, 0f, 0f)
            }

            prevSystemCPU = currentValues
            prevSystemTime = currentTime

            return result
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing system stat: ${stat.take(100)}", e)
            return null
        }
    }
}
