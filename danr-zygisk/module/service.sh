#!/system/bin/sh

MODDIR=${0%/*}

# Wait for boot to complete
while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 1
done

# Wait a bit more for system to stabilize
sleep 5

# Start the web server
ARCH=$(getprop ro.product.cpu.abi)

# Map architecture names
case "$ARCH" in
    arm64-v8a)
        BINARY="$MODDIR/bin/arm64-v8a/danr-webserver"
        ;;
    armeabi-v7a|armeabi)
        BINARY="$MODDIR/bin/armeabi-v7a/danr-webserver"
        ;;
    x86_64)
        BINARY="$MODDIR/bin/x86_64/danr-webserver"
        ;;
    x86)
        BINARY="$MODDIR/bin/x86/danr-webserver"
        ;;
    *)
        echo "Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

if [ ! -f "$BINARY" ]; then
    echo "Web server binary not found: $BINARY"
    exit 1
fi

# Kill existing instance if running
pkill -f danr-webserver

# Start web server in background
chmod 755 "$BINARY"
"$BINARY" > /dev/null 2>&1 &

# Get device IP addresses
WLAN_IP=$(ip addr show wlan0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d'/' -f1)
ETH_IP=$(ip addr show eth0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d'/' -f1)

# Log to stdout (Magisk logs)
echo "========================================"
echo "DANR Web Configuration Server Started"
echo "========================================"
echo "Port: 8765"
echo ""
echo "Access URLs:"
echo "  On device: http://localhost:8765"

if [ -n "$WLAN_IP" ]; then
    echo "  WiFi:      http://$WLAN_IP:8765"
fi

if [ -n "$ETH_IP" ]; then
    echo "  Ethernet:  http://$ETH_IP:8765"
fi

echo "========================================"

# Also log to Android logcat for easy access
log -t DANR-Service "Web server started on port 8765"
log -t DANR-Service "Access: http://localhost:8765"
[ -n "$WLAN_IP" ] && log -t DANR-Service "WiFi: http://$WLAN_IP:8765"
[ -n "$ETH_IP" ] && log -t DANR-Service "Ethernet: http://$ETH_IP:8765"

# Build app label cache in background (non-blocking)
log -t DANR-Cache "Building app label cache in background..."
sh "$MODDIR/build-label-cache.sh" > /dev/null 2>&1 &
