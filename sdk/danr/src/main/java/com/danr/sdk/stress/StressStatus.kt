package com.danr.sdk.stress

data class StressStatus(
    val type: String,
    val isRunning: Boolean,
    val remainingTimeMs: Long = 0,
    val data: Map<String, Any>? = null
)
