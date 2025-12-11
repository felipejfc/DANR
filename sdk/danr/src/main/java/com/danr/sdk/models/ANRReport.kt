package com.danr.sdk.models

import com.google.gson.annotations.SerializedName

data class ANRReport(
    @SerializedName("timestamp")
    val timestamp: String,

    @SerializedName("duration")
    val duration: Long,

    @SerializedName("mainThread")
    val mainThread: ThreadInfo,

    @SerializedName("allThreads")
    val allThreads: List<ThreadInfo>,

    @SerializedName("deviceInfo")
    val deviceInfo: DeviceInfo,

    @SerializedName("appInfo")
    val appInfo: AppInfo
)

data class ThreadInfo(
    @SerializedName("name")
    val name: String,

    @SerializedName("id")
    val id: Long,

    @SerializedName("state")
    val state: String,

    @SerializedName("stackTrace")
    val stackTrace: List<String>,

    @SerializedName("isMainThread")
    val isMainThread: Boolean
)

data class DeviceInfo(
    @SerializedName("manufacturer")
    val manufacturer: String,

    @SerializedName("model")
    val model: String,

    @SerializedName("osVersion")
    val osVersion: String,

    @SerializedName("sdkVersion")
    val sdkVersion: Int,

    @SerializedName("totalRam")
    val totalRam: Long,

    @SerializedName("availableRam")
    val availableRam: Long
)

data class AppInfo(
    @SerializedName("packageName")
    val packageName: String,

    @SerializedName("versionName")
    val versionName: String,

    @SerializedName("versionCode")
    val versionCode: Long,

    @SerializedName("isInForeground")
    val isInForeground: Boolean
)
