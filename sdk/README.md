# DANR Android SDK

## Setup Note

Before building the SDK, you need to add the Gradle wrapper files. You can do this by running:

```bash
cd sdk
gradle wrapper --gradle-version 8.2
```

This will generate the necessary Gradle wrapper files including:
- `gradlew` (Unix executable)
- `gradlew.bat` (Windows executable)
- `gradle/wrapper/gradle-wrapper.jar`
- `gradle/wrapper/gradle-wrapper.properties`

## Building the SDK

Once the wrapper is set up:

```bash
./gradlew clean build publishToMavenLocal
```

Or from the project root:

```bash
make sdk-build
```
