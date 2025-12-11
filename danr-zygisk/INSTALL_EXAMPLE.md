# Installation Output Example

## What You'll See in Magisk Console

When you flash the module in Magisk Manager, you'll see:

```
- Installing DANR Zygisk Module
- Creating default configuration

- Installation complete

========================================
  DANR Web Configuration Interface
========================================

Access the Web UI after reboot:

From this device:
  http://localhost:8765

From your computer (WiFi):
  http://192.168.1.100:8765

Manual config: /data/adb/modules/danr-zygisk/config.json

========================================

Restart whitelisted apps after config
```

## After Reboot

The web server will start automatically and log to both:

### 1. Magisk Module Logs
Check Magisk Manager → Modules → DANR Zygisk → View Logs

### 2. Android Logcat
```bash
adb logcat | grep DANR
```

You'll see:
```
========================================
DANR Web Configuration Server Started
========================================
Port: 8765

Access URLs:
  On device: http://localhost:8765
  WiFi:      http://192.168.1.100:8765
========================================

DANR-Service: Web server started on port 8765
DANR-Service: Access: http://localhost:8765
DANR-Service: WiFi: http://192.168.1.100:8765
```

## Finding Your Device IP

If the IP doesn't show during installation:

**Method 1: Android Settings**
- Settings → Network & Internet → Wi-Fi
- Tap your connected network
- Look for "IP address"

**Method 2: ADB**
```bash
adb shell ip addr show wlan0 | grep "inet "
```

**Method 3: Terminal Emulator on Device**
```bash
su
ip addr show wlan0 | grep "inet "
```

## Accessing the Web UI

Once you have the IP address:

**From the device:**
- Open any browser
- Go to `http://localhost:8765`

**From your computer (same network):**
- Open any browser
- Go to `http://<device-ip>:8765`
- Example: `http://192.168.1.100:8765`

## Web Interface Features

✅ Browse all installed apps
✅ Search and filter apps
✅ Select apps to monitor with checkboxes
✅ Configure DANR backend URL
✅ Set ANR threshold and options
✅ Save configuration with one click
✅ No need to edit JSON files manually

## Troubleshooting

**Can't access web UI:**
1. Check if web server is running: `adb shell ps | grep danr-webserver`
2. Verify port is open: `adb shell netstat -an | grep 8765`
3. Check logs: `adb logcat | grep DANR`
4. Restart module: Disable/Enable in Magisk Manager and reboot

**IP not showing during install:**
- The device might not be connected to network during installation
- Check Magisk module logs after reboot
- Use `adb logcat | grep DANR-Service` after boot

**"Connection refused" error:**
- Make sure you rebooted after installation
- Web server starts during boot, not during installation
- Wait ~30 seconds after boot for server to start
