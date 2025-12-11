package com.danr.sdk

data class DANRConfig(
    val backendUrl: String,
    val anrThresholdMs: Long = 5000,
    val enableInRelease: Boolean = true,
    val enableInDebug: Boolean = true,
    val autoStart: Boolean = true
)
