# DANR Zygisk - Quick Start Guide

Get DANR running in your apps in 5 minutes without rebuilding them.

## Prerequisites

- ✅ Rooted Android device with Magisk
- ✅ Zygisk enabled in Magisk settings
- ✅ DANR backend server running

## Steps

### 1. Build the Module

```bash
# Set environment variables
export ANDROID_NDK_HOME=/path/to/ndk
export ANDROID_HOME=/path/to/sdk

# Build
cd danr-zygisk
./build.sh
```

Output: `build/outputs/danr-zygisk-v1.0.0.zip`

### 2. Install on Device

```bash
# Transfer to device
adb push build/outputs/danr-zygisk-v1.0.0.zip /sdcard/

# Flash in Magisk Manager or via command line
adb shell su -c magisk --install-module /sdcard/danr-zygisk-v1.0.0.zip
```

### 3. Configure

```bash
# Edit config on device
adb shell

su
nano /data/adb/modules/danr-zygisk/config.json
```

Minimal configuration:

```json
{
  "whitelist": ["com.your.app"],
  "danrConfig": {
    "backendUrl": "http://your-server:8080",
    "anrThresholdMs": 5000,
    "enableWebSocket": true,
    "enableStressTesting": false
  }
}
```

### 4. Apply Changes

```bash
# Restart your app
adb shell am force-stop com.your.app
adb shell monkey -p com.your.app 1

# OR reboot
adb reboot
```

### 5. Verify

```bash
# Watch logs
adb logcat | grep DANR

# Expected:
# DANR-Zygisk: Package com.your.app is whitelisted, will inject DANR
# DANR-Zygisk: DANR SDK successfully initialized
```

## Done! 🎉

Your app now reports ANRs to the DANR backend without any code changes.

## Common Issues

**Module not working?**
→ Enable Zygisk in Magisk settings and reboot

**App not in whitelist?**
→ Get exact package name: `adb shell pm list packages | grep <keyword>`

**Backend not receiving reports?**
→ Check URL and network connectivity: `adb shell ping your-server`

## Next Steps

- Add more apps to whitelist
- Adjust ANR threshold
- Enable WebSocket for remote control
- View ANR reports in DANR dashboard

For full documentation, see [README.md](README.md)
