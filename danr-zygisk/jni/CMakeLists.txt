cmake_minimum_required(VERSION 3.18)
project(danr-zygisk)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Zygisk module
add_library(danr-zygisk SHARED main.cpp)

target_link_libraries(danr-zygisk
    log
    android
)

# Strip symbols for smaller binary
set_target_properties(danr-zygisk PROPERTIES
    LINK_FLAGS "-s"
)

# Web server executable
add_executable(danr-webserver webserver.cpp)

target_link_libraries(danr-webserver
    log
)

set_target_properties(danr-webserver PROPERTIES
    LINK_FLAGS "-s -static-libstdc++ -pthread"
)

# Build for multiple architectures
set(ANDROID_ABI "arm64-v8a" CACHE STRING "Target ABI")
set(ANDROID_PLATFORM "android-21" CACHE STRING "Target Android API level")
