#!/system/bin/sh

MODDIR=${0%/*}

# Ensure config file exists
if [ ! -f "$MODDIR/config.json" ]; then
    cp "$MODDIR/config.json.default" "$MODDIR/config.json"
fi

# Set proper permissions
chmod 644 "$MODDIR/config.json"
chmod 644 "$MODDIR/danr-sdk.dex"
chmod -R 755 "$MODDIR/bin"
chmod -R 644 "$MODDIR/web"
