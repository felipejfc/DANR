#!/bin/bash

set -e

echo "============================================"
echo "DANR Zygisk Module Build Script"
echo "============================================"
echo ""

# Check for required tools
check_tool() {
    if ! command -v $1 &> /dev/null; then
        echo "Error: $1 is not installed or not in PATH"
        exit 1
    fi
}

# Check environment variables
if [ -z "$ANDROID_NDK_HOME" ] && [ -z "$NDK_HOME" ]; then
    echo "Error: ANDROID_NDK_HOME or NDK_HOME environment variable not set"
    echo "Please set it to your Android NDK path"
    exit 1
fi

if [ -z "$ANDROID_HOME" ]; then
    echo "Error: ANDROID_HOME environment variable not set"
    echo "Please set it to your Android SDK path"
    exit 1
fi

NDK_PATH="${ANDROID_NDK_HOME:-$NDK_HOME}"
echo "Using NDK: $NDK_PATH"
echo "Using SDK: $ANDROID_HOME"
echo ""

# Step 1: Build DANR SDK as DEX
echo "[1/3] Building DANR SDK..."
cd ../sdk
./gradlew :danr:assembleRelease
cd ../danr-zygisk

echo "[1/3] Converting AAR + dependencies to fat DEX..."
AAR_FILE="../sdk/danr/build/outputs/aar/danr-release.aar"
DEPS_DIR="../sdk/danr/build/dependencies"

if [ ! -f "$AAR_FILE" ]; then
    echo "Error: AAR file not found at $AAR_FILE"
    exit 1
fi

if [ ! -d "$DEPS_DIR" ]; then
    echo "Error: Dependencies directory not found at $DEPS_DIR"
    echo "Run gradle :danr:copyDependencies first"
    exit 1
fi

# Extract SDK classes.jar
rm -rf temp
mkdir -p temp/jars
unzip -q "$AAR_FILE" classes.jar -d temp

# Copy SDK classes.jar
mv temp/classes.jar temp/jars/danr-sdk.jar

# Copy all dependency JARs (handle both .jar and .aar files)
echo "Bundling dependencies..."
for file in "$DEPS_DIR"/*; do
    if [[ "$file" == *.jar ]]; then
        cp "$file" temp/jars/
        echo "  + $(basename "$file")"
    elif [[ "$file" == *.aar ]]; then
        # Extract classes.jar from AAR dependencies
        aar_name=$(basename "$file" .aar)
        unzip -q -j "$file" classes.jar -d temp/jars/ 2>/dev/null && \
            mv temp/jars/classes.jar "temp/jars/${aar_name}.jar" && \
            echo "  + ${aar_name}.jar (from AAR)" || true
    fi
done

# Count JARs
JAR_COUNT=$(ls -1 temp/jars/*.jar 2>/dev/null | wc -l)
echo "Total JARs to bundle: $JAR_COUNT"

# Find d8 tool (prefer newer build-tools versions)
D8_TOOL=$(find "$ANDROID_HOME/build-tools" -name "d8" | sort -V | tail -n 1)
if [ -z "$D8_TOOL" ]; then
    echo "Error: d8 tool not found in Android SDK build-tools"
    exit 1
fi

echo "Using d8: $D8_TOOL"

# Convert all JARs to a single fat DEX
$D8_TOOL --release --output module temp/jars/*.jar
mv module/classes.dex module/danr-sdk.dex
rm -rf temp

# Show DEX size
DEX_SIZE=$(ls -lh module/danr-sdk.dex | awk '{print $5}')
echo "✓ Fat DEX file created: module/danr-sdk.dex ($DEX_SIZE)"
echo ""

# Step 2: Build native libraries
echo "[2/4] Building native Zygisk libraries and web server..."

ARCHITECTURES=("arm64-v8a" "armeabi-v7a" "x86_64" "x86")

for ABI in "${ARCHITECTURES[@]}"; do
    echo "Building for $ABI..."

    mkdir -p "module/zygisk"
    mkdir -p "jni/build-$ABI"

    cd jni/build-$ABI

    cmake \
        -DCMAKE_TOOLCHAIN_FILE="$NDK_PATH/build/cmake/android.toolchain.cmake" \
        -DANDROID_ABI="$ABI" \
        -DANDROID_PLATFORM=android-21 \
        -DCMAKE_BUILD_TYPE=Release \
        ..

    cmake --build .

    # Copy Zygisk module with correct naming: zygisk/arm64-v8a.so (not subdirectory)
    cp libdanr-zygisk.so "../../module/zygisk/$ABI.so"

    # Also copy webserver binary
    mkdir -p "../../module/bin/$ABI"
    cp danr-webserver "../../module/bin/$ABI/"

    cd ../..

    echo "✓ Built for $ABI"
done

echo ""

# Step 2.5: Copy web files
echo "[2.5/4] Copying web UI files and scripts..."
mkdir -p module/web
cp -r web/* module/web/
chmod 755 module/build-label-cache.sh
echo "✓ Web UI files and scripts copied"
echo ""

# Step 4: Package Magisk module
echo "[4/4] Packaging Magisk module..."

OUTPUT_DIR="build/outputs"
MODULE_NAME="danr-zygisk-v1.0.0.zip"

mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_DIR/$MODULE_NAME"

# Copy default config
cp config/config.json module/config.json.default

# Create ZIP
cd module
zip -r "../$OUTPUT_DIR/$MODULE_NAME" . -x "*.md"
cd ..

echo "✓ Module packaged: $OUTPUT_DIR/$MODULE_NAME"
echo ""

echo "============================================"
echo "Build completed successfully!"
echo "============================================"
echo ""
echo "Installation instructions:"
echo "1. Transfer $MODULE_NAME to your device"
echo "2. Flash it in Magisk Manager"
echo "3. Reboot device"
echo "4. Configure using Web UI or manually:"
echo ""
echo "   Option A: Web UI (Recommended)"
echo "   - Open http://localhost:8765 on device"
echo "   - Or http://<device-ip>:8765 from computer"
echo "   - Select apps and configure settings"
echo ""
echo "   Option B: Manual Configuration"
echo "   - Edit /data/adb/modules/danr-zygisk/config.json"
echo "   - Add app package names to whitelist"
echo "   - Configure backend URL and other settings"
echo ""
echo "5. Restart target apps for changes to take effect"
