plugins {
    id("com.android.library") version "8.1.0" apply false
}

buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.1.0")
    }
}

tasks.register("buildModule") {
    group = "build"
    description = "Build complete Magisk module with native libraries and DEX"

    dependsOn(":buildNative", ":packageDex", ":assembleModule")
}

tasks.register<Exec>("buildNative") {
    group = "build"
    description = "Build native Zygisk libraries for all architectures"

    workingDir = file("jni")

    val ndkPath = System.getenv("ANDROID_NDK_HOME") ?: System.getenv("NDK_HOME")
    if (ndkPath == null) {
        throw GradleException("ANDROID_NDK_HOME or NDK_HOME environment variable not set")
    }

    val architectures = listOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86")

    doFirst {
        println("Building native libraries for architectures: ${architectures.joinToString(", ")}")
    }

    commandLine = listOf("bash", "-c", """
        for ABI in ${architectures.joinToString(" ")}; do
            echo "Building for \$ABI..."
            mkdir -p ../module/zygisk/\$ABI
            $ndkPath/toolchains/llvm/prebuilt/*/bin/cmake \
                -DCMAKE_TOOLCHAIN_FILE=$ndkPath/build/cmake/android.toolchain.cmake \
                -DANDROID_ABI=\$ABI \
                -DANDROID_PLATFORM=android-21 \
                -DCMAKE_BUILD_TYPE=Release \
                -B build-\$ABI \
                .
            $ndkPath/toolchains/llvm/prebuilt/*/bin/cmake --build build-\$ABI
            cp build-\$ABI/libdanr-zygisk.so ../module/zygisk/\$ABI/
        done
    """.trimIndent())
}

tasks.register<Exec>("packageDex") {
    group = "build"
    description = "Package DANR SDK as DEX file"

    dependsOn(":sdk:danr:assembleRelease")

    doFirst {
        println("Converting DANR SDK AAR to DEX...")
    }

    commandLine = listOf("bash", "-c", """
        cd ../sdk/danr/build/outputs/aar
        AAR_FILE=$(ls danr-release.aar)

        # Extract classes.jar from AAR
        unzip -o \$AAR_FILE classes.jar -d temp

        # Convert JAR to DEX using d8
        ${System.getenv("ANDROID_HOME")}/build-tools/*/d8 \
            --release \
            --output ../../../../danr-zygisk/module/ \
            temp/classes.jar

        # Rename to danr-sdk.dex
        mv ../../../../danr-zygisk/module/classes.dex ../../../../danr-zygisk/module/danr-sdk.dex

        rm -rf temp

        echo "DEX file created: danr-sdk.dex"
    """.trimIndent())
}

tasks.register<Zip>("assembleModule") {
    group = "build"
    description = "Assemble flashable Magisk module ZIP"

    archiveFileName.set("danr-zygisk-v1.0.0.zip")
    destinationDirectory.set(file("$buildDir/outputs"))

    from("module") {
        exclude("README.md")
    }

    from("config/config.json") {
        rename { "config.json.default" }
    }

    // Ensure zygisk libs are included
    from("module/zygisk") {
        into("zygisk")
    }

    doLast {
        println("Magisk module created: ${archiveFile.get().asFile.absolutePath}")
        println("")
        println("Installation instructions:")
        println("1. Flash the ZIP in Magisk Manager")
        println("2. Edit /data/adb/modules/danr-zygisk/config.json")
        println("3. Add package names to the whitelist array")
        println("4. Reboot or restart target apps")
    }
}

tasks.register<Delete>("clean") {
    delete(buildDir)
    delete("jni/build-arm64-v8a", "jni/build-armeabi-v7a", "jni/build-x86_64", "jni/build-x86")
    delete("module/zygisk")
    delete("module/danr-sdk.dex")
}
