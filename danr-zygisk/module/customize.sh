#!/system/bin/sh

MODDIR=${0%/*}

ui_print "- Installing DANR Zygisk Module"

# Check if Zygisk is enabled
if [ ! -d "/data/adb/modules/zygisk-loader" ] && [ ! -f "/data/adb/magisk/zygisk" ]; then
    ui_print "! Warning: Zygisk doesn't appear to be enabled"
    ui_print "! Please enable Zygisk in Magisk settings and reboot"
fi

# Copy default config if not exists
if [ ! -f "$MODDIR/config.json" ]; then
    ui_print "- Creating default configuration"
    cp "$MODDIR/config.json.default" "$MODDIR/config.json"
else
    ui_print "- Existing config found, keeping it"
fi

ui_print "- Installation complete"
ui_print ""
ui_print "========================================"
ui_print "  DANR Web Configuration Interface"
ui_print "========================================"
ui_print ""

# Get device IP addresses
WLAN_IP=$(ip addr show wlan0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d'/' -f1)
ETH_IP=$(ip addr show eth0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d'/' -f1)

ui_print "Access the Web UI after reboot:"
ui_print ""
ui_print "From this device:"
ui_print "  http://localhost:8765"
ui_print ""

if [ -n "$WLAN_IP" ]; then
    ui_print "From your computer (WiFi):"
    ui_print "  http://$WLAN_IP:8765"
    ui_print ""
fi

if [ -n "$ETH_IP" ]; then
    ui_print "From your computer (Ethernet):"
    ui_print "  http://$ETH_IP:8765"
    ui_print ""
fi

if [ -z "$WLAN_IP" ] && [ -z "$ETH_IP" ]; then
    ui_print "From your computer:"
    ui_print "  http://<device-ip>:8765"
    ui_print "  (Get IP from Settings > Network)"
    ui_print ""
fi

ui_print "Manual config: $MODDIR/config.json"
ui_print ""
ui_print "========================================"
ui_print ""
ui_print "Restart whitelisted apps after config"

set_perm_recursive $MODDIR 0 0 0755 0644
chmod 0644 $MODDIR/zygisk/*.so
set_perm_recursive $MODDIR/bin 0 0 0755 0755
chmod 0644 $MODDIR/web/*
