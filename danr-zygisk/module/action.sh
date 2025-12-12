#!/system/bin/sh

# DANR Module Action Script
# Displayed as "Action" button in Magisk Manager (v28+)

MODDIR=${0%/*}

echo "=== DANR Daemon Reset ==="
echo ""

# Find and kill existing daemon
if pgrep -f danr-webserver > /dev/null; then
    echo "Stopping existing daemon..."
    pkill -f danr-webserver
    sleep 1
    echo "Daemon stopped."
else
    echo "No daemon running."
fi

# Determine architecture
ARCH=$(getprop ro.product.cpu.abi)
case "$ARCH" in
    arm64-v8a)
        ARCH_DIR="arm64-v8a"
        ;;
    armeabi-v7a|armeabi)
        ARCH_DIR="armeabi-v7a"
        ;;
    x86_64)
        ARCH_DIR="x86_64"
        ;;
    x86)
        ARCH_DIR="x86"
        ;;
    *)
        ARCH_DIR="arm64-v8a"
        ;;
esac

BINARY="$MODDIR/bin/$ARCH_DIR/danr-webserver"

echo ""
if [ -f "$BINARY" ]; then
    echo "Starting daemon ($ARCH_DIR)..."
    chmod 755 "$BINARY"
    "$BINARY" > /dev/null 2>&1 &
    sleep 1

    if pgrep -f danr-webserver > /dev/null; then
        PID=$(pgrep -f danr-webserver)
        echo "Daemon started successfully!"
        echo "PID: $PID"

        # Show IP info
        WLAN_IP=$(ip addr show wlan0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d'/' -f1)
        if [ -n "$WLAN_IP" ]; then
            echo ""
            echo "Access: http://$WLAN_IP:8765"
        fi
    else
        echo "ERROR: Daemon failed to start!"
    fi
else
    echo "ERROR: Binary not found: $BINARY"
fi

echo ""
echo "=== Done ==="
