# Keep DANR SDK public API
-keep public class com.danr.sdk.DANR { *; }
-keep public class com.danr.sdk.DANRConfig { *; }
-keep public class com.danr.sdk.models.** { *; }

# Keep OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Keep Gson
-keepattributes Signature
-keepattributes *Annotation*
-dontwarn sun.misc.**
-keep class com.google.gson.** { *; }
