package com.danr.sdk.collectors

import android.os.Looper
import com.danr.sdk.models.ThreadInfo

class ThreadInfoCollector {

    fun collectAllThreads(): List<ThreadInfo> {
        val threads = Thread.getAllStackTraces()
        val mainThread = Looper.getMainLooper().thread

        return threads.map { (thread, stackTrace) ->
            ThreadInfo(
                name = thread.name,
                id = thread.id,
                state = thread.state.name,
                stackTrace = stackTrace.map { it.toString() },
                isMainThread = thread == mainThread
            )
        }
    }

    fun collectMainThread(): ThreadInfo? {
        val mainThread = Looper.getMainLooper().thread
        val stackTrace = mainThread.stackTrace

        return ThreadInfo(
            name = mainThread.name,
            id = mainThread.id,
            state = mainThread.state.name,
            stackTrace = stackTrace.map { it.toString() },
            isMainThread = true
        )
    }
}
