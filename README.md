# DANR - ANR Debugging Tool

A comprehensive development-time ANR (Application Not Responding) debugging and analysis tool for Android applications. Monitor, collect, and analyze ANRs across your entire Android app portfolio.

## Overview

DANR consists of four main components:

| Component | Description | Technology |
|-----------|-------------|------------|
| **Android SDK** | Kotlin library that detects and reports ANRs | Kotlin, OkHttp, Coroutines |
| **Zygisk Module** | Runtime injection for monitoring apps without rebuilding | C++, Zygisk API |
| **Backend** | API that receives and processes ANR reports | Node.js, TypeScript, MongoDB |
| **Frontend** | Web dashboard for visualizing and analyzing ANRs | Next.js, React, Tailwind CSS |

## Architecture

```
                                    ┌─────────────────────────────────┐
                                    │         Frontend (Next.js)      │
                                    │      http://localhost:3000      │
                                    └────────────────┬────────────────┘
                                                     │ REST API
                                                     ▼
┌─────────────────────────────┐    HTTP/WS    ┌─────────────────────────────┐
│     Android Device          │──────────────▶│     Backend (Node.js)       │
│                             │               │    http://localhost:3001    │
│  ┌───────────────────────┐  │               └────────────────┬────────────┘
│  │   Target App          │  │                                │
│  │   ┌───────────────┐   │  │                                ▼
│  │   │   DANR SDK    │   │  │               ┌─────────────────────────────┐
│  │   │  (injected)   │   │  │               │       MongoDB               │
│  │   └───────────────┘   │  │               │    localhost:27017          │
│  └───────────────────────┘  │               └─────────────────────────────┘
│                             │
│  ┌───────────────────────┐  │
│  │   Zygisk Module       │  │
│  │   (root required)     │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

## Prerequisites & Dependencies

### System Requirements

| Requirement | Version | Purpose |
|------------|---------|---------|
| Node.js | 20+ | Backend & Frontend |
| Docker | Latest | MongoDB & containerization |
| Docker Compose | Latest | Service orchestration |
| Java/JDK | 17+ | Android SDK build |
| Android Studio | Latest | SDK development |
| Android SDK | API 21+ | SDK build tools |
| Android NDK | r25+ | Zygisk module build |

### For Zygisk Module (Optional)

- Rooted Android device with **Magisk v24.0+**
- **Zygisk enabled** in Magisk settings
- Android 8.0+ (API 26+) for InMemoryDexClassLoader support

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd danr
```

### 2. Install Dependencies

```bash
make setup
```

### 3. Start All Services

```bash
make dev
```

This starts:
- **MongoDB** on `localhost:27017`
- **Backend API** on `http://localhost:3001`
- **Frontend UI** on `http://localhost:3000`

### 4. Open the Dashboard

Navigate to [http://localhost:3000](http://localhost:3000) to view the ANR dashboard.

---

## Component 1: Android SDK

The DANR SDK is a Kotlin library that integrates into your Android app to detect and report ANRs.

### Features

- Automatic ANR detection on main thread
- Full thread dump capture when ANR occurs
- Device and app state collection
- Configurable ANR threshold
- WebSocket support for remote control
- Automatic retry with exponential backoff
- Works in both debug and release builds

### Integration

#### Add the SDK dependency

```kotlin
// app/build.gradle.kts
dependencies {
    implementation("com.danr:sdk:1.0.0")
}
```

#### Initialize in your Application class

```kotlin
import android.app.Application
import com.danr.sdk.DANR
import com.danr.sdk.DANRConfig

class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        val config = DANRConfig(
            backendUrl = "http://10.0.2.2:3001",  // Use 10.0.2.2 for emulator
            anrThresholdMs = 5000,                // 5 second threshold
            enableInDebug = true,
            enableInRelease = true,
            autoStart = true
        )

        DANR.initialize(this, config)
    }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `backendUrl` | String | - | Backend API URL (required) |
| `anrThresholdMs` | Long | 5000 | Milliseconds before ANR is detected |
| `enableInRelease` | Boolean | true | Enable in release builds |
| `enableInDebug` | Boolean | true | Enable in debug builds |
| `autoStart` | Boolean | true | Start monitoring automatically |

### Building the SDK

```bash
# Build and publish to local Maven repository
make sdk-build

# Or manually
cd sdk
./gradlew clean build publishToMavenLocal
```

---

## Component 2: Zygisk Module (Runtime Injection)

The Zygisk module allows you to inject the DANR SDK into **any** Android app at runtime without rebuilding it. This is ideal for monitoring production apps or third-party apps.

### Features

- **No rebuild required** - Inject into release APKs
- **Selective monitoring** - Whitelist specific apps
- **Web UI configuration** - Easy setup via browser
- **Fat DEX packaging** - All dependencies bundled (OkHttp, Gson, Coroutines, etc.)
- **Multi-architecture** - ARM64, ARM32, x86_64, x86

### Requirements

- Rooted device with **Magisk v24.0+**
- **Zygisk enabled** in Magisk settings
- Android 8.0+ (API 26+)

### Building the Module

#### Set Environment Variables

```bash
export ANDROID_NDK_HOME=/path/to/android-ndk
export ANDROID_HOME=/path/to/android-sdk
```

#### Build

```bash
cd danr-zygisk
./build.sh
```

Output: `build/outputs/danr-zygisk-v1.0.0.zip`

The build process:
1. Compiles the DANR SDK
2. Bundles all dependencies into a **fat DEX** (~6MB)
3. Compiles native Zygisk libraries for all architectures
4. Packages everything into a flashable ZIP

### Installation

1. Transfer `danr-zygisk-v1.0.0.zip` to your device
2. Open **Magisk Manager**
3. Go to **Modules** → **Install from storage**
4. Select the ZIP file
5. **Reboot** the device

### Configuration

#### Option A: Web UI (Recommended)

After reboot, access the configuration web UI:

- **On device**: `http://localhost:8765`
- **From computer**: `http://<device-ip>:8765`

The Web UI provides:
- Visual app selection with search
- Backend URL configuration
- One-click save

#### Option B: Manual Configuration

Edit the config file directly:

```bash
adb shell
su
vi /data/adb/modules/danr-zygisk/config.json
```

#### Configuration Format

```json
{
  "whitelist": [
    "com.example.app1",
    "com.example.app2"
  ],
  "danrConfig": {
    "backendUrl": "http://192.168.1.100:3001",
    "anrThresholdMs": 5000,
    "enableInRelease": true,
    "enableInDebug": true,
    "autoStart": true
  }
}
```

### Applying Changes

After modifying configuration:

```bash
# Restart specific app
adb shell am force-stop com.example.app

# Or reboot device
adb reboot
```

### Verifying Installation

```bash
adb logcat | grep DANR-Zygisk
```

Expected output:
```
DANR-Zygisk: ✓ Package 'com.example.app' IS whitelisted - will inject DANR
DANR-Zygisk: ✓ Created InMemoryDexClassLoader successfully
DANR-Zygisk: === ✓ DANR SDK SUCCESSFULLY INITIALIZED ===
```

---

## Component 3: Backend API

The backend receives ANR reports, stores them in MongoDB, and provides APIs for the frontend.

### Features

- RESTful API for ANR ingestion
- MongoDB storage with efficient indexing
- Automatic ANR deduplication
- Similarity-based grouping/clustering
- WebSocket for real-time device communication
- Analytics and aggregation

### API Endpoints

#### ANRs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/anrs` | Report a new ANR |
| `GET` | `/api/anrs` | Get all ANRs (with filtering, sorting, pagination) |
| `GET` | `/api/anrs/:id` | Get specific ANR details |
| `DELETE` | `/api/anrs/:id` | Delete specific ANR |
| `DELETE` | `/api/anrs` | Delete all ANRs |

#### Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/anrs/groups/all` | Get all ANR groups |

#### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/analytics` | Get analytics data |

#### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |

### Environment Variables

Create `backend/.env`:

```bash
NODE_ENV=development
PORT=3001
MONGODB_URI=mongodb://localhost:27017/danr
```

### Running Standalone

```bash
cd backend
npm install
npm run dev
```

---

## Component 4: Frontend Dashboard

The frontend provides a web interface for viewing and analyzing ANR reports.

### Features

- Modern UI with Tailwind CSS
- ANR list with filtering and sorting
- Detailed ANR view with syntax-highlighted stack traces
- ANR grouping by similarity
- Analytics dashboard with charts
- Device and app information display
- Real-time updates via WebSocket

### Pages

| Route | Description |
|-------|-------------|
| `/` | ANR list and overview |
| `/anr/[id]` | Detailed ANR view |
| `/groups` | ANR groups by similarity |
| `/analytics` | Charts and statistics |
| `/devices` | Connected devices |

### Environment Variables

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Running Standalone

```bash
cd frontend
npm install
npm run dev
```

---

## Project Structure

```
danr/
├── sdk/                        # Android SDK (Kotlin)
│   ├── danr/
│   │   ├── src/main/java/com/danr/sdk/
│   │   │   ├── DANR.kt                  # Main SDK interface
│   │   │   ├── DANRConfig.kt            # Configuration data class
│   │   │   ├── models/                  # Data models (ANRReport, etc.)
│   │   │   ├── detector/                # ANR detection logic
│   │   │   ├── collectors/              # Device/App/Thread info collectors
│   │   │   ├── reporter/                # HTTP reporting
│   │   │   ├── websocket/               # WebSocket client
│   │   │   └── stress/                  # Stress testing utilities
│   │   └── build.gradle.kts
│   ├── build.gradle.kts
│   └── settings.gradle.kts
│
├── danr-zygisk/                # Zygisk Module (C++)
│   ├── jni/
│   │   ├── main.cpp                     # Zygisk module implementation
│   │   ├── webserver.cpp                # Config web server
│   │   ├── zygisk.hpp                   # Zygisk API header
│   │   ├── json.hpp                     # JSON parser
│   │   └── CMakeLists.txt
│   ├── module/
│   │   ├── module.prop                  # Magisk module metadata
│   │   ├── customize.sh                 # Installation script
│   │   ├── service.sh                   # Service startup script
│   │   ├── post-fs-data.sh              # Boot script
│   │   └── zygisk/                      # Native libs (generated)
│   ├── web/                             # Web UI files
│   ├── config/
│   │   └── config.json                  # Default configuration
│   └── build.sh                         # Build script
│
├── backend/                    # Backend API (Node.js/TypeScript)
│   ├── src/
│   │   ├── index.ts                     # Server entry point
│   │   ├── config/
│   │   │   └── database.ts              # MongoDB connection
│   │   ├── models/
│   │   │   ├── ANR.ts                   # ANR Mongoose model
│   │   │   └── ANRGroup.ts              # Group model
│   │   ├── routes/
│   │   │   └── anrRoutes.ts             # API routes
│   │   ├── sockets/
│   │   │   └── deviceSocket.ts          # WebSocket handler
│   │   └── utils/
│   │       └── anrProcessor.ts          # ANR processing logic
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                   # Frontend (Next.js)
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                 # Home/ANR list
│   │   │   ├── layout.tsx               # Root layout
│   │   │   ├── anr/[id]/page.tsx        # ANR details
│   │   │   ├── groups/page.tsx          # ANR groups
│   │   │   ├── analytics/page.tsx       # Analytics
│   │   │   └── devices/page.tsx         # Devices
│   │   ├── components/ui/               # UI components
│   │   └── lib/
│   │       ├── api.ts                   # API client
│   │       └── utils.ts                 # Utilities
│   ├── package.json
│   ├── next.config.js
│   └── tailwind.config.ts
│
├── docker-compose.yml          # Docker orchestration
├── Makefile                    # Build commands
└── README.md                   # This file
```

---

## Makefile Commands

```bash
make help              # Show all available commands
make setup             # Install all dependencies
make dev               # Start all services (Docker)
make build             # Build all Docker images
make clean             # Stop containers and clean up
make logs              # View logs from all services
make sdk-build         # Build Android SDK
make backend-install   # Install backend dependencies
make frontend-install  # Install frontend dependencies
```

---

## Data Model

### ANR Document

```typescript
{
  timestamp: Date,
  duration: number,
  mainThread: {
    name: string,
    id: number,
    state: string,
    stackTrace: string[],
    isMainThread: boolean
  },
  allThreads: Thread[],
  deviceInfo: {
    manufacturer: string,
    model: string,
    osVersion: string,
    sdkVersion: number,
    totalRam: number,
    availableRam: number
  },
  appInfo: {
    packageName: string,
    versionName: string,
    versionCode: number,
    isInForeground: boolean
  },
  stackTraceHash: string,
  groupId?: ObjectId,
  occurrenceCount: number
}
```

### Grouping Algorithm

ANRs are automatically grouped based on stack trace similarity:
- **SHA-256 hashing** for exact duplicates
- **Jaccard similarity** for clustering similar ANRs
- **70% similarity threshold** by default

---

## Troubleshooting

### Android Emulator Connection

Use `10.0.2.2` instead of `localhost`:

```kotlin
backendUrl = "http://10.0.2.2:3001"
```

### Physical Device Connection

Use your machine's local IP:

```kotlin
backendUrl = "http://192.168.1.XXX:3001"
```

### MongoDB Connection Issues

Check if port 27017 is in use:

```bash
lsof -i :27017
```

### Zygisk Module Issues

| Problem | Solution |
|---------|----------|
| Module doesn't work | Enable Zygisk in Magisk settings and reboot |
| Config not found | Check `/data/adb/modules/danr-zygisk/config.json` exists |
| Wrong package name | Verify with `adb shell pm list packages \| grep <name>` |
| DEX not found | Verify `danr-sdk.dex` exists in module directory |
| Connection failed | Check backend URL and network connectivity |

### View Logs

```bash
# Backend logs
make logs

# Android SDK logs
adb logcat | grep DANR

# Zygisk module logs
adb logcat | grep DANR-Zygisk
```

---

## Security Considerations

- **Zygisk module requires root** - Use on development/testing devices only
- **Code injection** - The module injects code into app processes
- **Backend URL in config** - May contain sensitive information
- **Network traffic** - ANR reports contain stack traces and device info

---

## License

MIT

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
