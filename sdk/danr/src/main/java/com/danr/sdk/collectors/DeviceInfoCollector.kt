package com.danr.sdk.collectors

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import com.danr.sdk.models.DeviceInfo

class DeviceInfoCollector(private val context: Context) {

    fun collect(): DeviceInfo {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memoryInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memoryInfo)

        return DeviceInfo(
            manufacturer = Build.MANUFACTURER,
            model = Build.MODEL,
            osVersion = Build.VERSION.RELEASE,
            sdkVersion = Build.VERSION.SDK_INT,
            totalRam = memoryInfo.totalMem,
            availableRam = memoryInfo.availMem
        )
    }
}
