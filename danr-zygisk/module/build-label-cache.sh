#!/system/bin/sh
# Background script to build app label cache

CACHE_FILE="/data/local/tmp/danr-label-cache.json"
TEMP_FILE="/data/local/tmp/danr-label-cache.tmp"

# Create temporary cache object
echo "{" > "$TEMP_FILE"

# Get all packages and their labels
pm list packages 2>/dev/null | sort | while read line; do
    # Extract package name
    package="${line#package:}"

    # Try to get app label
    label=$(pm dump "$package" 2>/dev/null | grep -m1 'application-label:' | sed 's/.*application-label://; s/^['\''\"]//; s/['\''\"]$//')

    # If we got a label, add it to cache
    if [ -n "$label" ]; then
        # Escape quotes in label and package
        escaped_pkg=$(echo "$package" | sed 's/"/\\"/g')
        escaped_label=$(echo "$label" | sed 's/"/\\"/g')

        # Add to cache (append comma if not first entry)
        if [ -s "$TEMP_FILE" ] && [ "$(wc -l < "$TEMP_FILE")" -gt 1 ]; then
            echo "," >> "$TEMP_FILE"
        fi
        echo -n "  \"$escaped_pkg\":\"$escaped_label\"" >> "$TEMP_FILE"
    fi
done

# Close JSON object
echo "" >> "$TEMP_FILE"
echo "}" >> "$TEMP_FILE"

# Move temp file to cache file atomically
mv "$TEMP_FILE" "$CACHE_FILE"
chmod 644 "$CACHE_FILE"

log -t DANR-Cache "App label cache built successfully"
