# DANR Zygisk Module

Runtime injection of the DANR SDK into Android applications without rebuilding them. This Zygisk module allows you to monitor ANRs in any app by simply adding its package name to a whitelist.

## Features

- **No Rebuild Required**: Inject DANR into release apps without recompiling
- **Web UI Configuration**: Easy-to-use web interface for configuration (http://localhost:8765)
- **Selective Monitoring**: Whitelist specific apps to monitor
- **Runtime Configuration**: Change settings without rebuilding the module
- **Multi-Architecture**: Supports ARM64, ARM32, x86_64, and x86
- **Zero Performance Impact**: Only loads into whitelisted apps

## Requirements

- Rooted Android device
- Magisk v24.0+ with Zygisk enabled
- Android 5.0+ (API 21+)
- Android NDK (for building)
- Android SDK with build-tools (for building)

## Building the Module

### Prerequisites

1. Install Android NDK and SDK
2. Set environment variables:
   ```bash
   export ANDROID_NDK_HOME=/path/to/ndk
   export ANDROID_HOME=/path/to/sdk
   ```

### Build Steps

```bash
cd danr-zygisk
./build.sh
```

This will:
1. Build the DANR SDK as a DEX file
2. Compile native Zygisk libraries for all architectures
3. Package everything into a flashable ZIP: `build/outputs/danr-zygisk-v1.0.0.zip`

## Installation

1. **Enable Zygisk** in Magisk settings (if not already enabled)
2. Flash `danr-zygisk-v1.0.0.zip` in Magisk Manager
3. Reboot your device

## Configuration

DANR Zygisk offers **two ways to configure** the module:

### Option A: Web UI (Recommended) 🌐

After installation and reboot, a web server runs on your device at port 8765:

**Access from the device:**
```
http://localhost:8765
```

**Access from your computer (on same network):**
```
http://<device-ip>:8765
```

The Web UI provides:
- ✅ Visual app selection with search
- ✅ Easy configuration of backend URL and settings
- ✅ Live package list from your device
- ✅ One-click save

### Option B: Manual Configuration

Edit the configuration file directly on your device:

```bash
adb shell
su
nano /data/adb/modules/danr-zygisk/config.json
```

### Configuration Format

```json
{
  "whitelist": [
    "com.example.app1",
    "com.example.app2"
  ],
  "danrConfig": {
    "backendUrl": "http://your-backend-server:8080",
    "anrThresholdMs": 5000,
    "enableWebSocket": true,
    "enableStressTesting": false
  }
}
```

### Configuration Options

#### Whitelist
- **whitelist**: Array of package names to inject DANR into
- Only apps in this list will have DANR loaded

#### DANR Settings
- **backendUrl**: URL of your DANR backend server
- **anrThresholdMs**: Milliseconds before considering main thread blocked (default: 5000)
- **enableWebSocket**: Enable WebSocket for remote control (default: true)
- **enableStressTesting**: Enable stress testing features (default: false)

### Applying Configuration Changes

After modifying `config.json`:

```bash
# Option 1: Restart specific apps
adb shell am force-stop com.example.app1

# Option 2: Reboot device
adb reboot
```

Configuration is loaded when apps start, so you must restart apps (or reboot) for changes to take effect.

## Usage Examples

### Example 1: Monitor a Single App

```json
{
  "whitelist": ["com.mycompany.production.app"],
  "danrConfig": {
    "backendUrl": "http://192.168.1.100:8080",
    "anrThresholdMs": 5000,
    "enableWebSocket": true,
    "enableStressTesting": false
  }
}
```

### Example 2: Monitor Multiple Apps

```json
{
  "whitelist": [
    "com.app1",
    "com.app2",
    "com.app3"
  ],
  "danrConfig": {
    "backendUrl": "http://my-backend.example.com:8080",
    "anrThresholdMs": 3000,
    "enableWebSocket": false,
    "enableStressTesting": false
  }
}
```

### Example 3: Development with Stress Testing

```json
{
  "whitelist": ["com.example.dev"],
  "danrConfig": {
    "backendUrl": "http://localhost:8080",
    "anrThresholdMs": 2000,
    "enableWebSocket": true,
    "enableStressTesting": true
  }
}
```

## Verifying Installation

Check if DANR is being injected:

```bash
# View Zygisk logs
adb logcat | grep DANR-Zygisk

# Expected output when app starts:
# DANR-Zygisk: Package com.example.app is whitelisted, will inject DANR
# DANR-Zygisk: Injecting DANR SDK...
# DANR-Zygisk: DANR SDK successfully initialized
```

## Troubleshooting

### Zygisk Not Enabled
**Error**: Module installs but doesn't work
**Solution**: Enable Zygisk in Magisk settings and reboot

### Config File Not Found
**Error**: Apps start but DANR not loaded
**Solution**: Ensure `/data/adb/modules/danr-zygisk/config.json` exists

### Wrong Package Name
**Error**: DANR not loading in expected app
**Solution**: Verify package name with `adb shell pm list packages | grep <app-name>`

### DEX Not Found
**Error**: "Failed to create DexClassLoader"
**Solution**: Verify `/data/adb/modules/danr-zygisk/danr-sdk.dex` exists and is readable

### Backend Connection Failed
**Error**: DANR loads but doesn't report ANRs
**Solution**:
- Verify backend URL is correct and accessible
- Check network connectivity from the app
- Review DANR logs: `adb logcat | grep DANR`

### Library Not Found for Architecture
**Error**: "dlopen failed: library not found"
**Solution**: Rebuild module ensuring all architectures are built

## Architecture

### Components

1. **Native Zygisk Module** (`libdanr-zygisk.so`)
   - Hooks app initialization via Zygisk
   - Reads config and checks whitelist
   - Injects DANR DEX into app classloader

2. **DANR SDK DEX** (`danr-sdk.dex`)
   - Converted from DANR SDK AAR
   - Loaded dynamically into target apps
   - Initialized with config from JSON

3. **Configuration** (`config.json`)
   - Whitelist of target apps
   - Global DANR settings
   - Read on app startup

### Injection Flow

```
App Launch
    ↓
Zygisk Hook (preAppSpecialize)
    ↓
Read config.json
    ↓
Check if package in whitelist
    ↓
[YES] → postAppSpecialize
    ↓
Load danr-sdk.dex via DexClassLoader
    ↓
Get Application context
    ↓
Call DANR.initialize(context, config)
    ↓
DANR monitoring begins
```

## Development

### Project Structure

```
danr-zygisk/
├── jni/                    # Native code
│   ├── main.cpp           # Zygisk module implementation
│   ├── zygisk.hpp         # Zygisk API header
│   ├── json.hpp           # JSON parser (replace with full nlohmann/json)
│   └── CMakeLists.txt     # Build configuration
├── module/                # Magisk module files
│   ├── module.prop        # Module metadata
│   ├── customize.sh       # Installation script
│   ├── post-fs-data.sh    # Boot script
│   └── zygisk/            # Native libraries (generated)
│       ├── arm64-v8a/
│       ├── armeabi-v7a/
│       ├── x86_64/
│       └── x86/
├── config/
│   └── config.json        # Default configuration
├── build.sh               # Build script
└── README.md              # This file
```

### Modifying the Module

1. **Change Injection Logic**: Edit `jni/main.cpp`
2. **Update Config Schema**: Modify `config/config.json` and update parsing in `main.cpp`
3. **Add Features**: Extend `injectDanrSdk()` or `initializeDanr()` methods

### Building for Development

```bash
# Clean build
rm -rf jni/build-* module/zygisk module/danr-sdk.dex

# Rebuild
./build.sh

# Quick test on device
adb push build/outputs/danr-zygisk-v1.0.0.zip /sdcard/
# Flash in Magisk and reboot
```

## Notes

- The JSON parser in `jni/json.hpp` is a stub. For production, download the full [nlohmann/json](https://github.com/nlohmann/json) single-header library.
- Apps must be restarted after configuration changes (no hot-reload)
- DANR only loads into whitelisted apps for minimal system impact
- Compatible with Magisk's DenyList and other Zygisk modules

## Security Considerations

- Module requires root access (Magisk requirement)
- Injects code into app processes - use responsibly
- Backend URL in config may contain sensitive information
- Recommended for development/testing devices only

## License

Same license as the DANR SDK project.

## Support

For issues and questions:
- DANR SDK issues: Main repository
- Zygisk module issues: Check Magisk/Zygisk documentation
- Configuration problems: Review logs with `adb logcat | grep DANR`
