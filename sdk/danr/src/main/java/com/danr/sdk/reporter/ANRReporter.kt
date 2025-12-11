package com.danr.sdk.reporter

import android.util.Log
import com.danr.sdk.models.ANRReport
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class ANRReporter(private val backendUrl: String) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()
    private val mediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun report(anrReport: ANRReport): Boolean {
        return withContext(Dispatchers.IO) {
            try {
                val json = gson.toJson(anrReport)
                val requestBody = json.toRequestBody(mediaType)

                val request = Request.Builder()
                    .url("$backendUrl/api/anrs")
                    .post(requestBody)
                    .build()

                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        Log.d(TAG, "ANR report sent successfully")
                        true
                    } else {
                        Log.e(TAG, "Failed to send ANR report: ${response.code}")
                        false
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error sending ANR report", e)
                false
            }
        }
    }

    companion object {
        private const val TAG = "ANRReporter"
    }
}
