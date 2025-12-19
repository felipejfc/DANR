#!/bin/bash
# Downloads simpleperf binaries from Android NDK

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# NDK version to download from (these are prebuilt binaries)
NDK_SIMPLEPERF_URL="https://android.googlesource.com/platform/prebuilts/simpleperf/+archive/refs/heads/main/bin/android"

echo "Downloading simpleperf binaries..."

# Create directories
mkdir -p "$SCRIPT_DIR/arm64-v8a"
mkdir -p "$SCRIPT_DIR/armeabi-v7a"

# Download from Android NDK GitHub releases or use local NDK
if [ -n "$ANDROID_NDK_HOME" ]; then
    echo "Using local NDK at: $ANDROID_NDK_HOME"

    # Copy from NDK
    if [ -f "$ANDROID_NDK_HOME/simpleperf/bin/android/arm64/simpleperf" ]; then
        cp "$ANDROID_NDK_HOME/simpleperf/bin/android/arm64/simpleperf" "$SCRIPT_DIR/arm64-v8a/simpleperf"
        echo "Copied arm64 simpleperf"
    fi

    if [ -f "$ANDROID_NDK_HOME/simpleperf/bin/android/arm/simpleperf" ]; then
        cp "$ANDROID_NDK_HOME/simpleperf/bin/android/arm/simpleperf" "$SCRIPT_DIR/armeabi-v7a/simpleperf"
        echo "Copied arm32 simpleperf"
    fi
else
    echo "ANDROID_NDK_HOME not set. Please either:"
    echo "1. Set ANDROID_NDK_HOME environment variable and run this script again"
    echo "2. Manually copy simpleperf binaries from your NDK installation:"
    echo "   - \$NDK/simpleperf/bin/android/arm64/simpleperf -> arm64-v8a/simpleperf"
    echo "   - \$NDK/simpleperf/bin/android/arm/simpleperf -> armeabi-v7a/simpleperf"
    echo ""
    echo "Or download from: https://developer.android.com/ndk/guides/simpleperf"
    exit 1
fi

# Verify files
if [ -f "$SCRIPT_DIR/arm64-v8a/simpleperf" ]; then
    echo "arm64-v8a/simpleperf: $(ls -lh "$SCRIPT_DIR/arm64-v8a/simpleperf" | awk '{print $5}')"
else
    echo "WARNING: arm64-v8a/simpleperf not found!"
fi

if [ -f "$SCRIPT_DIR/armeabi-v7a/simpleperf" ]; then
    echo "armeabi-v7a/simpleperf: $(ls -lh "$SCRIPT_DIR/armeabi-v7a/simpleperf" | awk '{print $5}')"
else
    echo "WARNING: armeabi-v7a/simpleperf not found!"
fi

echo ""
echo "Done! Make sure to add these files to your app's assets."
