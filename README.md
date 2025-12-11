# DANR - ANR Debugging Tool

A comprehensive development-time ANR (Application Not Responding) debugging and analysis tool for Android applications.

## Overview

DANR consists of four main components:

1. **Android SDK** - Kotlin library that detects and reports ANRs from your Android app
2. **Zygisk Module** - Runtime injection for monitoring apps without rebuilding (root required)
3. **Backend** - Node.js/TypeScript API that receives and processes ANR reports
4. **Frontend** - Next.js web application for visualizing and analyzing ANRs

## Features

### Android SDK
- ✅ Automatic ANR detection on main and background threads
- ✅ Full thread dump capture
- ✅ Device and app state collection
- ✅ Configurable ANR threshold
- ✅ Works in both debug and release builds
- ✅ Automatic retry with exponential backoff

### Backend
- ✅ RESTful API for ANR ingestion
- ✅ MongoDB storage with efficient indexing
- ✅ Automatic ANR deduplication
- ✅ Similarity-based grouping/clustering
- ✅ Analytics and aggregation
- ✅ Filtering and sorting capabilities

### Frontend
- ✅ Modern, beautiful UI with Tailwind CSS
- ✅ ANR list with filtering and sorting
- ✅ Detailed ANR view with syntax-highlighted stack traces
- ✅ ANR grouping by similarity
- ✅ Analytics dashboard with charts
- ✅ Device and app information display
- ✅ Thread dump visualization

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Android Studio (for SDK development)
- Java 17+ (for building the SDK)

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd danr
```

2. Install dependencies:
```bash
make setup
```

3. Start all services:
```bash
make dev
```

This will start:
- MongoDB on `localhost:27017`
- Backend API on `http://localhost:3001`
- Frontend UI on `http://localhost:3000`

### Build the Android SDK

```bash
make sdk-build
```

This builds the SDK and publishes it to your local Maven repository.

## Integration Options

DANR offers two ways to integrate ANR monitoring into your apps:

### Option 1: SDK Integration (Standard)
Best for apps you're actively developing. Requires code changes and rebuilding.

### Option 2: Zygisk Module (Runtime Injection)
Best for monitoring release apps without rebuilding. Requires root access.

See [danr-zygisk/README.md](danr-zygisk/README.md) for Zygisk module documentation.

---

## Using the Android SDK (Option 1)

### 1. Add the SDK to your Android project

Add to your app's `build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.danr:sdk:1.0.0")
}
```

### 2. Initialize DANR in your Application class

```kotlin
import android.app.Application
import com.danr.sdk.DANR
import com.danr.sdk.DANRConfig

class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        val config = DANRConfig(
            backendUrl = "http://10.0.2.2:3001", // Use 10.0.2.2 for Android emulator
            anrThresholdMs = 5000,
            enableInDebug = true,
            enableInRelease = true,
            autoStart = true
        )

        DANR.initialize(this, config)
    }
}
```

### 3. ANRs will be automatically detected and reported

The SDK will:
- Monitor the main thread for blocks
- Capture full thread dumps when ANRs occur
- Collect device and app information
- Send reports to your backend automatically

## API Endpoints

### ANRs
- `POST /api/anrs` - Report a new ANR
- `GET /api/anrs` - Get all ANRs (supports filtering, sorting, pagination)
- `GET /api/anrs/:id` - Get specific ANR details
- `DELETE /api/anrs/:id` - Delete specific ANR
- `DELETE /api/anrs` - Delete all ANRs

### Groups
- `GET /api/anrs/groups/all` - Get all ANR groups

### Analytics
- `GET /api/analytics` - Get analytics data

## Architecture

```
┌─────────────────┐
│  Android App    │
│  (with SDK)     │
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────┐
│  Backend API    │
│  (Node.js)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│    MongoDB      │◄────│  Frontend UI    │
│                 │     │   (Next.js)     │
└─────────────────┘     └─────────────────┘
```

## Project Structure

```
danr/
├── sdk/                    # Android SDK (Kotlin)
│   ├── danr/              # Library module
│   │   ├── src/main/java/com/danr/sdk/
│   │   │   ├── DANR.kt                    # Main SDK interface
│   │   │   ├── DANRConfig.kt              # Configuration
│   │   │   ├── models/                    # Data models
│   │   │   ├── detector/                  # ANR detection
│   │   │   ├── collectors/                # Data collection
│   │   │   └── reporter/                  # Network reporting
│   │   └── build.gradle.kts
│   └── build.gradle.kts
│
├── danr-zygisk/           # Zygisk runtime injection module
│   ├── jni/                                # C++ native code
│   ├── module/                             # Magisk module files
│   ├── config/                             # Default configuration
│   ├── build.sh                            # Build script
│   └── README.md                           # Zygisk documentation
│
├── backend/               # Node.js/TypeScript API
│   ├── src/
│   │   ├── index.ts                       # Server entry point
│   │   ├── config/                        # Configuration
│   │   ├── models/                        # Mongoose models
│   │   ├── routes/                        # API routes
│   │   ├── services/                      # Business logic
│   │   └── utils/                         # Utilities
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/              # Next.js frontend
│   ├── src/
│   │   ├── app/                           # App router pages
│   │   │   ├── page.tsx                   # Home/ANR list
│   │   │   ├── anr/[id]/page.tsx          # ANR details
│   │   │   ├── groups/page.tsx            # ANR groups
│   │   │   └── analytics/page.tsx         # Analytics
│   │   ├── components/                    # UI components
│   │   └── lib/                           # Utilities & API client
│   ├── package.json
│   └── next.config.js
│
├── docker-compose.yml     # Docker orchestration
├── Makefile              # Build commands
└── README.md             # This file
```

## Development

### Makefile Commands

```bash
make help              # Show all available commands
make setup             # Install all dependencies
make dev               # Start all services
make build             # Build all components
make clean             # Clean up containers and volumes
make logs              # View logs from all services
make sdk-build         # Build and publish Android SDK
make backend-install   # Install backend dependencies only
make frontend-install  # Install frontend dependencies only
```

### Environment Variables

#### Backend (.env)
```bash
NODE_ENV=development
PORT=3001
MONGODB_URI=mongodb://localhost:27017/danr
```

#### Frontend (.env.local)
```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Configuration

### SDK Configuration Options

```kotlin
DANRConfig(
    backendUrl: String,           // Backend API URL
    anrThresholdMs: Long = 5000,  // ANR detection threshold in ms
    enableInRelease: Boolean = true,
    enableInDebug: Boolean = true,
    autoStart: Boolean = true     // Start monitoring automatically
)
```

### ANR Detection

The SDK monitors the main thread by posting a task to the main looper and checking if it executes within the threshold. If the task doesn't execute in time, an ANR is detected.

### Grouping Algorithm

ANRs are automatically grouped based on stack trace similarity using:
- SHA-256 hashing for exact duplicates
- Jaccard similarity for clustering similar ANRs
- Configurable similarity threshold (70% by default)

## Data Model

### ANR Document
```typescript
{
  timestamp: Date
  duration: number
  mainThread: {
    name: string
    id: number
    state: string
    stackTrace: string[]
    isMainThread: boolean
  }
  allThreads: Thread[]
  deviceInfo: {
    manufacturer: string
    model: string
    osVersion: string
    sdkVersion: number
    totalRam: number
    availableRam: number
  }
  appInfo: {
    packageName: string
    versionName: string
    versionCode: number
    isInForeground: boolean
  }
  stackTraceHash: string
  groupId?: ObjectId
  occurrenceCount: number
}
```

## Troubleshooting

### Android Emulator Connection

If using an Android emulator, use `10.0.2.2` instead of `localhost` to connect to your host machine:

```kotlin
backendUrl = "http://10.0.2.2:3001"
```

### Physical Device Connection

For physical devices, use your machine's local IP address:

```kotlin
backendUrl = "http://192.168.1.XXX:3001"
```

### MongoDB Connection Issues

If MongoDB fails to start, ensure port 27017 is not in use:

```bash
lsof -i :27017
```

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
