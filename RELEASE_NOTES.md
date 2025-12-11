# DANR v1.0.0 - Initial Release

**Release Date:** December 2024

The first public release of DANR - a comprehensive ANR (Application Not Responding) debugging and analysis tool for Android applications.

---

## Highlights

- **Full ANR Detection Pipeline** - From detection on device to visualization in dashboard
- **Two Integration Methods** - SDK integration or runtime injection via Zygisk
- **Fat DEX Packaging** - Zygisk module bundles all dependencies for universal app compatibility
- **Real-time Monitoring** - WebSocket support for live device communication
- **Smart Grouping** - Automatic ANR clustering based on stack trace similarity

---

## Components

### Android SDK (`com.danr:sdk:1.0.0`)

A Kotlin library for detecting and reporting ANRs from your Android applications.

**Features:**
- Automatic main thread ANR detection
- Configurable ANR threshold (default: 5 seconds)
- Full thread dump capture
- Device and app state collection
- Automatic retry with exponential backoff
- WebSocket support for remote control
- Works in both debug and release builds

**Usage:**
```kotlin
val config = DANRConfig(
    backendUrl = "http://your-server:3001",
    anrThresholdMs = 5000,
    autoStart = true
)
DANR.initialize(this, config)
```

---

### Zygisk Module

Runtime injection of DANR SDK into any Android app without rebuilding. Ideal for monitoring production or third-party apps.

**Features:**
- No rebuild required - inject into release APKs
- Selective app monitoring via whitelist
- Web UI configuration at `http://localhost:8765`
- Fat DEX packaging (~6MB) with all dependencies bundled:
  - OkHttp 4.12.0
  - Socket.IO Client 2.1.0
  - Gson 2.11.0
  - Kotlin Coroutines 1.9.0
  - And 25+ transitive dependencies
- Multi-architecture support (ARM64, ARM32, x86_64, x86)
- InMemoryDexClassLoader for Android 8.0+

**Requirements:**
- Rooted device with Magisk v24.0+
- Zygisk enabled
- Android 8.0+ (API 26+)

---

### Backend API

Node.js/TypeScript server for receiving and processing ANR reports.

**Features:**
- RESTful API for ANR ingestion
- MongoDB storage with efficient indexing
- Automatic ANR deduplication via SHA-256 hashing
- Similarity-based grouping using Jaccard similarity
- WebSocket for real-time device communication
- Analytics and aggregation endpoints

**Endpoints:**
- `POST /api/anrs` - Report new ANR
- `GET /api/anrs` - List ANRs with filtering/pagination
- `GET /api/anrs/:id` - Get ANR details
- `GET /api/anrs/groups/all` - Get ANR groups
- `GET /api/analytics` - Analytics data

---

### Frontend Dashboard

Next.js web application for visualizing and analyzing ANR reports.

**Features:**
- Modern UI with Tailwind CSS
- ANR list with filtering and sorting
- Syntax-highlighted stack traces
- ANR grouping by similarity
- Analytics dashboard with charts
- Device and app information display
- Real-time updates via WebSocket

**Pages:**
- `/` - ANR list and overview
- `/anr/[id]` - Detailed ANR view
- `/groups` - ANR groups by similarity
- `/analytics` - Charts and statistics
- `/devices` - Connected devices

---

## Getting Started

### Quick Start (Docker)

```bash
# Clone repository
git clone https://github.com/your-org/danr.git
cd danr

# Install dependencies
make setup

# Start all services
make dev
```

Services will be available at:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- MongoDB: localhost:27017

### Build Zygisk Module

```bash
export ANDROID_NDK_HOME=/path/to/ndk
export ANDROID_HOME=/path/to/sdk

cd danr-zygisk
./build.sh
```

Output: `build/outputs/danr-zygisk-v1.0.0.zip`

---

## System Requirements

| Component | Requirement |
|-----------|-------------|
| Node.js | 20+ |
| Docker | Latest |
| Java/JDK | 17+ |
| Android SDK | API 21+ |
| Android NDK | r25+ (for Zygisk) |

---

## Known Limitations

- Zygisk module requires Android 8.0+ due to InMemoryDexClassLoader dependency
- WebSocket connection requires network connectivity from target app
- ANR detection threshold minimum is 1 second

---

## What's Next

Planned for future releases:
- ANR symbolication with mapping files
- Slack/Discord webhook notifications
- ANR comparison and diff view
- Export reports to CSV/JSON
- Multi-tenant support

---

## Documentation

- [Full Documentation](README.md)
- [Zygisk Module Guide](danr-zygisk/README.md)
- [SDK Integration](sdk/README.md)

---

## License

MIT

---

## Acknowledgments

- [Zygisk](https://github.com/topjohnwu/Magisk) - Runtime code injection framework
- [nlohmann/json](https://github.com/nlohmann/json) - JSON for Modern C++
- [OkHttp](https://square.github.io/okhttp/) - HTTP client for Android
- [Socket.IO](https://socket.io/) - Real-time communication
