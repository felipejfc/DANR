#include <jni.h>
#include <string>
#include <vector>
#include <fstream>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <cstring>
#include <thread>
#include <chrono>
#include <android/log.h>
#include "zygisk.hpp"
#include "json.hpp"

#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, "DANR-Zygisk", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "DANR-Zygisk", __VA_ARGS__)

using json = nlohmann::json;
using zygisk::Api;
using zygisk::AppSpecializeArgs;
using zygisk::ServerSpecializeArgs;

class DanrModule : public zygisk::ModuleBase {
private:
    Api *api;
    JNIEnv *env;
    JavaVM *jvm;
    std::vector<std::string> whitelist;
    json danrConfig;
    bool shouldInject = false;
    std::vector<char> dexData;

    bool loadConfig() {
        // Use Zygisk API to get module directory (handles SELinux permissions)
        int dirfd = api->getModuleDir();
        if (dirfd < 0) {
            LOGE("Failed to get module directory fd");
            return false;
        }

        // Open config.json relative to module directory
        int configFd = openat(dirfd, "config.json", O_RDONLY);
        if (configFd < 0) {
            LOGE("Failed to open config.json: %s", strerror(errno));
            return false;
        }

        // Read file contents
        std::string configContent;
        char buffer[4096];
        ssize_t bytesRead;
        while ((bytesRead = read(configFd, buffer, sizeof(buffer))) > 0) {
            configContent.append(buffer, bytesRead);
        }
        close(configFd);

        if (bytesRead < 0) {
            LOGE("Failed to read config file: %s", strerror(errno));
            return false;
        }

        try {
            json config = json::parse(configContent);

            try {
                auto& whitelistArray = config["whitelist"];
                if (whitelistArray.is_array()) {
                    for (const auto& pkg : whitelistArray) {
                        if (pkg.is_string()) {
                            std::string pkgName = pkg.get<std::string>();
                            whitelist.push_back(pkgName);
                        }
                    }
                } else {
                    LOGD("WARNING: whitelist exists but is not an array!");
                }
            } catch (const std::exception& e) {
                LOGD("WARNING: Exception accessing whitelist: %s", e.what());
            } catch (...) {
                LOGD("WARNING: Unknown exception accessing whitelist!");
            }

            try {
                auto& danrCfg = config["danrConfig"];
                if (danrCfg.is_object()) {
                    danrConfig = danrCfg;
                }
            } catch (...) {
                LOGD("WARNING: danrConfig not found in config!");
            }

            return true;
        } catch (const std::exception& e) {
            LOGE("Failed to parse config: %s", e.what());
            return false;
        }
    }

    bool isWhitelisted(const char* packageName) {
        if (!packageName) return false;

        std::string pkg(packageName);
        for (const auto& whitelistedPkg : whitelist) {
            if (pkg == whitelistedPkg) {
                return true;
            }
        }
        return false;
    }

public:
    void onLoad(Api *api, JNIEnv *env) override {
        this->api = api;
        this->env = env;
        env->GetJavaVM(&this->jvm);
        LOGD("DANR Zygisk module loaded");
    }

    void preAppSpecialize(AppSpecializeArgs *args) override {

        if (!args || !args->nice_name) {
            LOGE("preAppSpecialize: args or nice_name is null");
            return;
        }

        const char* packageName = env->GetStringUTFChars(args->nice_name, nullptr);
        LOGD("Processing package: %s", packageName);

        if (!loadConfig()) {
            LOGE("Failed to load config, skipping injection for %s", packageName);
            env->ReleaseStringUTFChars(args->nice_name, packageName);
            return;
        }

        shouldInject = isWhitelisted(packageName);

        if (shouldInject) {
            LOGD("✓ Package '%s' IS whitelisted - will inject DANR", packageName);

            // Read DEX file into memory while API is still valid
            if (!loadDexIntoMemory()) {
                LOGE("Failed to load DEX file into memory");
                shouldInject = false;
            }
        }

        env->ReleaseStringUTFChars(args->nice_name, packageName);
    }

    void postAppSpecialize(const AppSpecializeArgs *args) override {
        if (!shouldInject) {
            return;
        }

        LOGD("=== postAppSpecialize: STARTING DANR INJECTION ===");

        // Spawn background thread to wait for Application to be ready
        std::thread([this]() {
            JNIEnv *threadEnv = nullptr;
            if (jvm->AttachCurrentThread(&threadEnv, nullptr) != JNI_OK || !threadEnv) {
                LOGE("Failed to attach thread to JVM");
                return;
            }

            // Poll for Application availability
            const int maxRetries = 50;
            const int retryDelayMs = 100;

            for (int attempt = 1; attempt <= maxRetries; attempt++) {
                if (attempt > 1) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(retryDelayMs));
                }

                jclass activityThreadClass = threadEnv->FindClass("android/app/ActivityThread");
                if (!activityThreadClass) {
                    threadEnv->ExceptionClear();
                    continue;
                }

                jmethodID currentActivityThreadMethod = threadEnv->GetStaticMethodID(
                    activityThreadClass, "currentActivityThread", "()Landroid/app/ActivityThread;");
                if (!currentActivityThreadMethod) {
                    threadEnv->ExceptionClear();
                    continue;
                }

                jobject activityThread = threadEnv->CallStaticObjectMethod(activityThreadClass, currentActivityThreadMethod);
                if (!activityThread) {
                    threadEnv->ExceptionClear();
                    continue;
                }

                jfieldID mInitialApplicationField = threadEnv->GetFieldID(
                    activityThreadClass, "mInitialApplication", "Landroid/app/Application;");
                if (!mInitialApplicationField) {
                    threadEnv->ExceptionClear();
                    continue;
                }

                jobject application = threadEnv->GetObjectField(activityThread, mInitialApplicationField);
                if (!application) {
                    threadEnv->ExceptionClear();
                    continue;
                }

                // Application is ready, inject DANR
                LOGD("✓ Got Application instance (attempt %d)", attempt);

                if (injectDanrSdk(threadEnv, application)) {
                    LOGD("=== DANR SDK INJECTION COMPLETED SUCCESSFULLY ===");
                } else {
                    LOGE("!!! DANR SDK INJECTION FAILED !!!");
                }

                jvm->DetachCurrentThread();
                return;
            }

            LOGE("!!! Failed to get Application after %d attempts !!!", maxRetries);
            jvm->DetachCurrentThread();
        }).detach();
    }

private:
    bool loadDexIntoMemory() {
        // Read DEX file into memory using Zygisk API
        int moduleDirFd = api->getModuleDir();
        if (moduleDirFd < 0) {
            LOGE("FAILED: Could not get module directory fd");
            return false;
        }

        // Open source DEX file
        int sourceFd = openat(moduleDirFd, "danr-sdk.dex", O_RDONLY);
        if (sourceFd < 0) {
            LOGE("FAILED: Could not open danr-sdk.dex: %s", strerror(errno));
            return false;
        }

        // Get file size
        off_t fileSize = lseek(sourceFd, 0, SEEK_END);
        lseek(sourceFd, 0, SEEK_SET);

        if (fileSize <= 0) {
            LOGE("FAILED: Invalid DEX file size");
            close(sourceFd);
            return false;
        }

        LOGD("Loading DEX file into memory (%ld bytes)", (long)fileSize);

        // Read entire file into memory
        dexData.resize(fileSize);
        ssize_t totalRead = 0;
        while (totalRead < fileSize) {
            ssize_t bytesRead = read(sourceFd, dexData.data() + totalRead, fileSize - totalRead);
            if (bytesRead <= 0) {
                LOGE("FAILED: Read error: %s", strerror(errno));
                close(sourceFd);
                return false;
            }
            totalRead += bytesRead;
        }

        close(sourceFd);
        LOGD("✓ DEX file loaded into memory successfully");
        return true;
    }

    bool injectDanrSdk(JNIEnv *threadEnv, jobject application) {
        try {
            LOGD("Step 1: Loading DANR SDK DEX from memory...");

            // Use InMemoryDexClassLoader (Android 8.0+) to load directly from memory
            jclass inMemoryDexClassLoaderClass = threadEnv->FindClass("dalvik/system/InMemoryDexClassLoader");
            if (!inMemoryDexClassLoaderClass) {
                LOGE("FAILED: Could not find InMemoryDexClassLoader (requires Android 8.0+)");
                threadEnv->ExceptionClear();
                return false;
            }
            LOGD("✓ Found InMemoryDexClassLoader class");

            // Create ByteBuffer from DEX data
            jclass byteBufferClass = threadEnv->FindClass("java/nio/ByteBuffer");
            jmethodID allocateDirectMethod = threadEnv->GetStaticMethodID(
                byteBufferClass, "allocateDirect", "(I)Ljava/nio/ByteBuffer;");
            jobject byteBuffer = threadEnv->CallStaticObjectMethod(
                byteBufferClass, allocateDirectMethod, (jint)dexData.size());

            if (!byteBuffer) {
                LOGE("FAILED: Could not allocate ByteBuffer");
                return false;
            }

            // Get direct buffer address and copy DEX data
            void* bufferAddr = threadEnv->GetDirectBufferAddress(byteBuffer);
            if (!bufferAddr) {
                LOGE("FAILED: Could not get direct buffer address");
                return false;
            }
            memcpy(bufferAddr, dexData.data(), dexData.size());
            LOGD("✓ Copied %zu bytes to ByteBuffer", dexData.size());

            // Get parent classloader
            jmethodID getClassLoaderMethod = threadEnv->GetMethodID(
                threadEnv->GetObjectClass(application),
                "getClassLoader",
                "()Ljava/lang/ClassLoader;"
            );
            jobject parentClassLoader = threadEnv->CallObjectMethod(application, getClassLoaderMethod);
            LOGD("✓ Got parent ClassLoader");

            // Create InMemoryDexClassLoader(ByteBuffer, ClassLoader)
            jmethodID inMemoryDexClassLoaderInit = threadEnv->GetMethodID(
                inMemoryDexClassLoaderClass,
                "<init>",
                "(Ljava/nio/ByteBuffer;Ljava/lang/ClassLoader;)V"
            );

            jobject dexClassLoader = threadEnv->NewObject(
                inMemoryDexClassLoaderClass,
                inMemoryDexClassLoaderInit,
                byteBuffer,
                parentClassLoader
            );

            if (threadEnv->ExceptionCheck()) {
                LOGE("FAILED: Exception creating InMemoryDexClassLoader");
                threadEnv->ExceptionDescribe();
                threadEnv->ExceptionClear();
                return false;
            }

            if (!dexClassLoader) {
                LOGE("FAILED: InMemoryDexClassLoader is null");
                return false;
            }
            LOGD("✓ Created InMemoryDexClassLoader successfully");

            LOGD("Step 2: Loading DANR class from DEX...");
            // Load DANR class
            jmethodID loadClassMethod = threadEnv->GetMethodID(
                inMemoryDexClassLoaderClass,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;"
            );

            jstring danrClassName = threadEnv->NewStringUTF("com.danr.sdk.DANR");
            jclass danrClass = (jclass)threadEnv->CallObjectMethod(dexClassLoader, loadClassMethod, danrClassName);

            if (threadEnv->ExceptionCheck()) {
                LOGE("FAILED: Exception loading DANR class");
                threadEnv->ExceptionDescribe();
                threadEnv->ExceptionClear();
                return false;
            }

            if (!danrClass) {
                LOGE("FAILED: DANR class is null (class may not exist in DEX)");
                return false;
            }
            LOGD("✓ Loaded com.danr.sdk.DANR class successfully");

            LOGD("Step 4: Loading DANRConfig class from DEX...");
            // Load DANRConfig class using the same DexClassLoader
            jstring configClassName = threadEnv->NewStringUTF("com.danr.sdk.DANRConfig");
            jclass configClass = (jclass)threadEnv->CallObjectMethod(dexClassLoader, loadClassMethod, configClassName);

            if (threadEnv->ExceptionCheck()) {
                LOGE("FAILED: Exception loading DANRConfig class");
                threadEnv->ExceptionDescribe();
                threadEnv->ExceptionClear();
                return false;
            }

            if (!configClass) {
                LOGE("FAILED: DANRConfig class is null (class may not exist in DEX)");
                return false;
            }
            LOGD("✓ Loaded com.danr.sdk.DANRConfig class successfully");

            LOGD("Step 2: Initializing DANR SDK...");
            // Initialize DANR with configuration
            return initializeDanr(threadEnv, danrClass, configClass, application);

        } catch (...) {
            LOGE("!!! EXCEPTION during DANR injection !!!");
            return false;
        }
    }

    bool initializeDanr(JNIEnv *threadEnv, jclass danrClass, jclass configClass, jobject application) {
        LOGD("Step 4a: Creating DANRConfig instance...");

        // DANRConfig constructor: (String backendUrl, long anrThresholdMs, boolean enableInRelease, boolean enableInDebug, boolean autoStart)
        jmethodID configConstructor = threadEnv->GetMethodID(
            configClass,
            "<init>",
            "(Ljava/lang/String;JZZZ)V"
        );
        if (!configConstructor) {
            LOGE("FAILED: Could not find DANRConfig constructor(String, long, boolean, boolean, boolean)");
            threadEnv->ExceptionDescribe();
            threadEnv->ExceptionClear();
            return false;
        }

        // Get config values from JSON (with defaults matching SDK)
        std::string backendUrl = danrConfig.value("backendUrl", "http://localhost:8080");
        long anrThresholdMs = danrConfig.value("anrThresholdMs", 5000L);
        bool enableInRelease = danrConfig.value("enableInRelease", true);
        bool enableInDebug = danrConfig.value("enableInDebug", true);
        bool autoStart = danrConfig.value("autoStart", true);

        LOGD("  backendUrl: %s", backendUrl.c_str());
        LOGD("  anrThresholdMs: %ld", anrThresholdMs);
        LOGD("  enableInRelease: %d", enableInRelease);
        LOGD("  enableInDebug: %d", enableInDebug);
        LOGD("  autoStart: %d", autoStart);

        jstring backendUrlStr = threadEnv->NewStringUTF(backendUrl.c_str());

        jobject configObj = threadEnv->NewObject(
            configClass,
            configConstructor,
            backendUrlStr,
            (jlong)anrThresholdMs,
            (jboolean)enableInRelease,
            (jboolean)enableInDebug,
            (jboolean)autoStart
        );

        if (threadEnv->ExceptionCheck()) {
            LOGE("FAILED: Exception creating DANRConfig instance");
            threadEnv->ExceptionDescribe();
            threadEnv->ExceptionClear();
            return false;
        }
        if (!configObj) {
            LOGE("FAILED: DANRConfig instance is null");
            return false;
        }
        LOGD("✓ Created DANRConfig instance");

        LOGD("Step 4b: Getting DANR.INSTANCE...");
        // DANR is a Kotlin object (singleton), access via static INSTANCE field
        jfieldID instanceField = threadEnv->GetStaticFieldID(
            danrClass,
            "INSTANCE",
            "Lcom/danr/sdk/DANR;"
        );
        if (!instanceField) {
            LOGE("FAILED: Could not find DANR.INSTANCE field");
            threadEnv->ExceptionDescribe();
            threadEnv->ExceptionClear();
            return false;
        }

        jobject danrInstance = threadEnv->GetStaticObjectField(danrClass, instanceField);
        if (!danrInstance) {
            LOGE("FAILED: DANR.INSTANCE is null");
            return false;
        }
        LOGD("✓ Got DANR.INSTANCE");

        LOGD("Step 4c: Calling DANR.initialize()...");
        jmethodID initializeMethod = threadEnv->GetMethodID(
            danrClass,
            "initialize",
            "(Landroid/content/Context;Lcom/danr/sdk/DANRConfig;)V"
        );

        if (!initializeMethod) {
            LOGE("FAILED: Could not find DANR.initialize method");
            threadEnv->ExceptionDescribe();
            threadEnv->ExceptionClear();
            return false;
        }
        LOGD("✓ Found DANR.initialize method");

        threadEnv->CallVoidMethod(danrInstance, initializeMethod, application, configObj);

        if (threadEnv->ExceptionCheck()) {
            LOGE("!!! FAILED: Exception during DANR.initialize() call !!!");
            threadEnv->ExceptionDescribe();
            threadEnv->ExceptionClear();
            return false;
        }

        LOGD("=== ✓ DANR SDK SUCCESSFULLY INITIALIZED ===");
        return true;
    }
};

REGISTER_ZYGISK_MODULE(DanrModule)
