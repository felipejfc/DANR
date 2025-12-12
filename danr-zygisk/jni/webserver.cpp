#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <pthread.h>
#include <signal.h>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <map>
#include <set>
#include <dirent.h>
#include <android/log.h>

#include "stress/stress_manager.h"
#include "cpu_freq_manager.h"

#define PORT 8765
#define BUFFER_SIZE 8192
#define CONFIG_PATH "/data/adb/modules/danr-zygisk/config.json"
#define WEB_ROOT "/data/adb/modules/danr-zygisk/web"

#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, "DANR-WebServer", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "DANR-WebServer", __VA_ARGS__)

static volatile int keep_running = 1;

void signal_handler(int signum) {
    LOGD("Received signal %d, shutting down...", signum);
    keep_running = 0;
}

std::string read_file(const char* path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        return "";
    }
    std::stringstream buffer;
    buffer << file.rdbuf();
    return buffer.str();
}

bool write_file(const char* path, const std::string& content) {
    std::ofstream file(path);
    if (!file.is_open()) {
        return false;
    }
    file << content;
    file.close();
    return true;
}

std::string escape_json_string(const std::string& str) {
    std::string result;
    for (char c : str) {
        switch (c) {
            case '"': result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default: result += c; break;
        }
    }
    return result;
}


std::map<std::string, std::string> load_label_cache() {
    const char* cache_path = "/data/local/tmp/danr-label-cache.json";
    std::map<std::string, std::string> cache;

    std::ifstream file(cache_path);
    if (!file.is_open()) {
        return cache; // Empty cache if file doesn't exist
    }

    std::string line;
    std::getline(file, line); // Skip opening brace
    while (std::getline(file, line)) {
        if (line.find("}") != std::string::npos) break;

        // Parse "package":"label" format
        size_t first_quote = line.find('"');
        if (first_quote == std::string::npos) continue;

        size_t second_quote = line.find('"', first_quote + 1);
        if (second_quote == std::string::npos) continue;

        size_t third_quote = line.find('"', second_quote + 1);
        if (third_quote == std::string::npos) continue;

        size_t fourth_quote = line.find('"', third_quote + 1);
        if (fourth_quote == std::string::npos) continue;

        std::string package = line.substr(first_quote + 1, second_quote - first_quote - 1);
        std::string label = line.substr(third_quote + 1, fourth_quote - third_quote - 1);

        cache[package] = label;
    }

    file.close();
    return cache;
}

void save_label_cache(const std::map<std::string, std::string>& cache) {
    const char* cache_path = "/data/local/tmp/danr-label-cache.json";
    std::ofstream file(cache_path);
    if (!file.is_open()) {
        return;
    }

    file << "{\n";
    bool first = true;
    for (const auto& entry : cache) {
        if (!first) file << ",\n";
        file << "  \"" << escape_json_string(entry.first) << "\":\"" << escape_json_string(entry.second) << "\"";
        first = false;
    }
    file << "\n}\n";

    file.close();
}

std::string get_installed_packages() {
    std::string result = "[";

    // Load existing cache - only use cached labels, don't fetch new ones
    std::map<std::string, std::string> label_cache = load_label_cache();

    // Get all packages - fast operation
    FILE* pipe = popen("pm list packages 2>/dev/null | sort", "r");
    if (pipe) {
        char buffer[256];
        bool first = true;

        while (fgets(buffer, sizeof(buffer), pipe)) {
            // Remove "package:" prefix and newline
            char* pkg = buffer + 8; // Skip "package:"
            size_t len = strlen(pkg);
            if (len > 0 && pkg[len-1] == '\n') {
                pkg[len-1] = '\0';
            }

            std::string package = pkg;
            std::string label;

            // Use cached label if available (don't fetch if not cached)
            if (label_cache.find(package) != label_cache.end()) {
                label = label_cache[package];
            }

            if (!first) result += ",";
            result += "{";
            result += "\"package\":\"" + escape_json_string(package) + "\"";
            if (!label.empty()) {
                result += ",\"label\":\"" + escape_json_string(label) + "\"";
            }
            result += "}";
            first = false;
        }
        pclose(pipe);
    }

    result += "]";
    return result;
}

std::string url_decode(const std::string& str) {
    std::string result;
    char ch;
    int i, ii;
    for (i=0; i<str.length(); i++) {
        if (str[i] == '%') {
            sscanf(str.substr(i+1,2).c_str(), "%x", &ii);
            ch = static_cast<char>(ii);
            result += ch;
            i = i+2;
        } else if (str[i] == '+') {
            result += ' ';
        } else {
            result += str[i];
        }
    }
    return result;
}

void send_response(int client_socket, int status_code, const char* status_text,
                   const char* content_type, const std::string& body) {
    std::stringstream response;
    response << "HTTP/1.1 " << status_code << " " << status_text << "\r\n";
    response << "Content-Type: " << content_type << "\r\n";
    response << "Content-Length: " << body.length() << "\r\n";
    response << "Access-Control-Allow-Origin: *\r\n";
    response << "Connection: close\r\n";
    response << "\r\n";
    response << body;

    std::string resp = response.str();
    send(client_socket, resp.c_str(), resp.length(), 0);
}

void send_json(int client_socket, const std::string& json) {
    send_response(client_socket, 200, "OK", "application/json", json);
}

void send_html(int client_socket, const std::string& html) {
    send_response(client_socket, 200, "OK", "text/html; charset=utf-8", html);
}

void send_404(int client_socket) {
    send_response(client_socket, 404, "Not Found", "text/plain", "404 Not Found");
}

void send_500(int client_socket, const char* error) {
    send_response(client_socket, 500, "Internal Server Error", "text/plain", error);
}

void handle_get_config(int client_socket) {
    std::string config = read_file(CONFIG_PATH);
    if (config.empty()) {
        send_500(client_socket, "Failed to read config file");
        return;
    }
    send_json(client_socket, config);
}

void handle_get_packages(int client_socket) {
    std::string packages = get_installed_packages();
    send_json(client_socket, packages);
}

void handle_save_config(int client_socket, const std::string& body) {
    if (body.empty()) {
        send_500(client_socket, "Empty config");
        return;
    }

    if (write_file(CONFIG_PATH, body)) {
        send_json(client_socket, "{\"success\":true,\"message\":\"Configuration saved. Restart apps for changes to take effect.\"}");
        LOGD("Configuration updated");
    } else {
        send_500(client_socket, "Failed to write config file");
    }
}

void handle_get_logs(int client_socket) {
    // Get last 500 lines of DANR-related logs from logcat
    std::string cmd = "logcat -d -t 500 | grep -E '(DANR|danr)' 2>/dev/null";
    FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe) {
        send_500(client_socket, "Failed to read logs");
        return;
    }

    std::string logs;
    char buffer[1024];
    while (fgets(buffer, sizeof(buffer), pipe)) {
        logs += buffer;
    }
    pclose(pipe);

    send_response(client_socket, 200, "OK", "text/plain; charset=utf-8", logs);
}

// ============================================================================
// JSON Parsing Helpers for Stress API
// ============================================================================

int parse_json_int(const std::string& json, const std::string& key, int defaultVal) {
    std::string searchKey = "\"" + key + "\"";
    size_t keyPos = json.find(searchKey);
    if (keyPos == std::string::npos) return defaultVal;

    size_t colonPos = json.find(':', keyPos);
    if (colonPos == std::string::npos) return defaultVal;

    size_t valueStart = colonPos + 1;
    while (valueStart < json.size() && isspace(json[valueStart])) valueStart++;

    return atoi(json.c_str() + valueStart);
}

long parse_json_long(const std::string& json, const std::string& key, long defaultVal) {
    std::string searchKey = "\"" + key + "\"";
    size_t keyPos = json.find(searchKey);
    if (keyPos == std::string::npos) return defaultVal;

    size_t colonPos = json.find(':', keyPos);
    if (colonPos == std::string::npos) return defaultVal;

    size_t valueStart = colonPos + 1;
    while (valueStart < json.size() && isspace(json[valueStart])) valueStart++;

    return atol(json.c_str() + valueStart);
}

bool parse_json_bool(const std::string& json, const std::string& key, bool defaultVal) {
    std::string searchKey = "\"" + key + "\"";
    size_t keyPos = json.find(searchKey);
    if (keyPos == std::string::npos) return defaultVal;

    size_t colonPos = json.find(':', keyPos);
    if (colonPos == std::string::npos) return defaultVal;

    size_t valueStart = colonPos + 1;
    while (valueStart < json.size() && isspace(json[valueStart])) valueStart++;

    return (json.substr(valueStart, 4) == "true");
}

std::string parse_json_string(const std::string& json, const std::string& key, const std::string& defaultVal) {
    std::string searchKey = "\"" + key + "\"";
    size_t keyPos = json.find(searchKey);
    if (keyPos == std::string::npos) return defaultVal;

    size_t colonPos = json.find(':', keyPos);
    if (colonPos == std::string::npos) return defaultVal;

    size_t startQuote = json.find('"', colonPos);
    if (startQuote == std::string::npos) return defaultVal;

    size_t endQuote = json.find('"', startQuote + 1);
    if (endQuote == std::string::npos) return defaultVal;

    return json.substr(startQuote + 1, endQuote - startQuote - 1);
}

// ============================================================================
// Stress API Handlers
// ============================================================================

void handle_stress_status(int client_socket) {
    std::string json = danr::StressManager::getInstance().getAllStatusJson();
    send_json(client_socket, "{\"success\":true,\"data\":" + json + "}");
}

void handle_stress_cpu_start(int client_socket, const std::string& body) {
    danr::CPUStressConfig config;
    config.threadCount = parse_json_int(body, "threadCount", 4);
    config.loadPercentage = parse_json_int(body, "loadPercentage", 100);
    config.durationMs = parse_json_long(body, "durationMs", 300000);
    config.pinToCores = parse_json_bool(body, "pinToCores", false);

    if (danr::StressManager::getInstance().startCpuStress(config)) {
        send_json(client_socket, "{\"success\":true,\"message\":\"CPU stress test started\"}");
    } else {
        send_json(client_socket, "{\"success\":false,\"error\":\"Failed to start CPU stress test (may already be running)\"}");
    }
}

void handle_stress_cpu_stop(int client_socket) {
    danr::StressManager::getInstance().stopCpuStress();
    send_json(client_socket, "{\"success\":true,\"message\":\"CPU stress test stopped\"}");
}

void handle_stress_memory_start(int client_socket, const std::string& body) {
    danr::MemoryStressConfig config;
    config.targetFreeMB = parse_json_int(body, "targetFreeMB", 100);
    config.chunkSizeMB = parse_json_int(body, "chunkSizeMB", 10);
    config.durationMs = parse_json_long(body, "durationMs", 300000);
    config.useAnonymousMmap = parse_json_bool(body, "useAnonymousMmap", true);
    config.lockMemory = parse_json_bool(body, "lockMemory", false);

    if (danr::StressManager::getInstance().startMemoryStress(config)) {
        send_json(client_socket, "{\"success\":true,\"message\":\"Memory stress test started\"}");
    } else {
        send_json(client_socket, "{\"success\":false,\"error\":\"Failed to start memory stress test (may already be running)\"}");
    }
}

void handle_stress_memory_stop(int client_socket) {
    danr::StressManager::getInstance().stopMemoryStress();
    send_json(client_socket, "{\"success\":true,\"message\":\"Memory stress test stopped\"}");
}

void handle_stress_disk_start(int client_socket, const std::string& body) {
    danr::DiskStressConfig config;
    config.throughputMBps = parse_json_int(body, "throughputMBps", 5);
    config.chunkSizeKB = parse_json_int(body, "chunkSizeKB", 100);
    config.durationMs = parse_json_long(body, "durationMs", 300000);
    config.useDirectIO = parse_json_bool(body, "useDirectIO", false);
    config.syncWrites = parse_json_bool(body, "syncWrites", false);

    std::string testPath = parse_json_string(body, "testPath", "/data/local/tmp/danr_stress");
    if (!testPath.empty()) {
        config.testPath = testPath;
    }

    if (danr::StressManager::getInstance().startDiskStress(config)) {
        send_json(client_socket, "{\"success\":true,\"message\":\"Disk stress test started\"}");
    } else {
        send_json(client_socket, "{\"success\":false,\"error\":\"Failed to start disk stress test (may already be running)\"}");
    }
}

void handle_stress_disk_stop(int client_socket) {
    danr::StressManager::getInstance().stopDiskStress();
    send_json(client_socket, "{\"success\":true,\"message\":\"Disk stress test stopped\"}");
}

void handle_stress_network_start(int client_socket, const std::string& body) {
    danr::NetworkStressConfig config;
    config.bandwidthLimitKbps = parse_json_int(body, "bandwidthLimitKbps", 0);
    config.latencyMs = parse_json_int(body, "latencyMs", 0);
    config.packetLossPercent = parse_json_int(body, "packetLossPercent", 0);
    config.durationMs = parse_json_long(body, "durationMs", 300000);

    std::string iface = parse_json_string(body, "targetInterface", "wlan0");
    if (!iface.empty()) {
        config.targetInterface = iface;
    }

    if (danr::StressManager::getInstance().startNetworkStress(config)) {
        send_json(client_socket, "{\"success\":true,\"message\":\"Network stress test started\"}");
    } else {
        send_json(client_socket, "{\"success\":false,\"error\":\"Failed to start network stress test (requires root and tc command)\"}");
    }
}

void handle_stress_network_stop(int client_socket) {
    danr::StressManager::getInstance().stopNetworkStress();
    send_json(client_socket, "{\"success\":true,\"message\":\"Network stress test stopped\"}");
}

void handle_stress_thermal_start(int client_socket, const std::string& body) {
    danr::ThermalStressConfig config;
    config.disableThermalThrottling = parse_json_bool(body, "disableThermalThrottling", false);
    config.maxFrequencyPercent = parse_json_int(body, "maxFrequencyPercent", 100);
    config.forceAllCoresOnline = parse_json_bool(body, "forceAllCoresOnline", true);
    config.durationMs = parse_json_long(body, "durationMs", 300000);

    if (danr::StressManager::getInstance().startThermalStress(config)) {
        send_json(client_socket, "{\"success\":true,\"message\":\"Thermal stress test started\"}");
    } else {
        send_json(client_socket, "{\"success\":false,\"error\":\"Failed to start thermal stress test (may already be running)\"}");
    }
}

void handle_stress_thermal_stop(int client_socket) {
    danr::StressManager::getInstance().stopThermalStress();
    send_json(client_socket, "{\"success\":true,\"message\":\"Thermal stress test stopped\"}");
}

void handle_stress_stop_all(int client_socket) {
    danr::StressManager::getInstance().stopAll();
    send_json(client_socket, "{\"success\":true,\"message\":\"All stress tests stopped\"}");
}

// ============================================================================
// CPU Frequency API Handlers
// ============================================================================

std::vector<int> parse_json_int_array(const std::string& json, const std::string& key) {
    std::vector<int> result;
    std::string searchKey = "\"" + key + "\"";
    size_t keyPos = json.find(searchKey);
    if (keyPos == std::string::npos) return result;

    size_t colonPos = json.find(':', keyPos);
    if (colonPos == std::string::npos) return result;

    size_t bracketStart = json.find('[', colonPos);
    if (bracketStart == std::string::npos) return result;

    size_t bracketEnd = json.find(']', bracketStart);
    if (bracketEnd == std::string::npos) return result;

    std::string arrayStr = json.substr(bracketStart + 1, bracketEnd - bracketStart - 1);

    // Parse comma-separated integers
    std::istringstream iss(arrayStr);
    std::string token;
    while (std::getline(iss, token, ',')) {
        // Trim whitespace
        size_t start = token.find_first_not_of(" \t\n\r");
        if (start != std::string::npos) {
            int val = atoi(token.c_str() + start);
            result.push_back(val);
        }
    }

    return result;
}

void handle_cpu_freq_status(int client_socket) {
    danr::CPUFreqStatus status = danr::CPUFreqManager::getInstance().getStatus();
    send_json(client_socket, "{\"success\":true,\"data\":" + status.toJson() + "}");
}

void handle_cpu_freq_set(int client_socket, const std::string& body) {
    long frequency = parse_json_long(body, "frequency", 0);
    if (frequency <= 0) {
        send_json(client_socket, "{\"success\":false,\"error\":\"Invalid frequency\"}");
        return;
    }

    std::vector<int> cores = parse_json_int_array(body, "cores");
    long autoRestoreMs = parse_json_long(body, "autoRestoreMs", 0);

    if (danr::CPUFreqManager::getInstance().setMaxFrequency(frequency, cores, autoRestoreMs)) {
        send_json(client_socket, "{\"success\":true,\"message\":\"CPU frequency set\"}");
    } else {
        send_json(client_socket, "{\"success\":false,\"error\":\"Failed to set CPU frequency\"}");
    }
}

void handle_cpu_freq_restore(int client_socket) {
    if (danr::CPUFreqManager::getInstance().restore()) {
        send_json(client_socket, "{\"success\":true,\"message\":\"CPU frequency restored\"}");
    } else {
        send_json(client_socket, "{\"success\":false,\"error\":\"Failed to restore CPU frequency\"}");
    }
}

void* handle_client(void* arg) {
    int client_socket = *(int*)arg;
    free(arg);

    char buffer[BUFFER_SIZE];
    int bytes_read = recv(client_socket, buffer, sizeof(buffer) - 1, 0);

    if (bytes_read <= 0) {
        close(client_socket);
        return nullptr;
    }

    buffer[bytes_read] = '\0';

    // Parse HTTP request
    char method[16], path[256], protocol[16];
    sscanf(buffer, "%s %s %s", method, path, protocol);

    LOGD("Request: %s %s", method, path);

    // Find body (after \r\n\r\n)
    char* body_start = strstr(buffer, "\r\n\r\n");
    std::string body;
    if (body_start) {
        body = std::string(body_start + 4);
    }

    // Route requests
    if (strcmp(method, "GET") == 0) {
        if (strcmp(path, "/") == 0 || strcmp(path, "/index.html") == 0) {
            std::string html = read_file((std::string(WEB_ROOT) + "/index.html").c_str());
            if (!html.empty()) {
                send_html(client_socket, html);
            } else {
                send_404(client_socket);
            }
        } else if (strcmp(path, "/api/config") == 0) {
            handle_get_config(client_socket);
        } else if (strcmp(path, "/api/packages") == 0) {
            handle_get_packages(client_socket);
        } else if (strcmp(path, "/api/logs") == 0) {
            handle_get_logs(client_socket);
        } else if (strcmp(path, "/api/stress/status") == 0) {
            handle_stress_status(client_socket);
        } else if (strcmp(path, "/api/cpu/freq/status") == 0) {
            handle_cpu_freq_status(client_socket);
        } else if (strncmp(path, "/style.css", 10) == 0) {
            std::string css = read_file((std::string(WEB_ROOT) + "/style.css").c_str());
            if (!css.empty()) {
                send_response(client_socket, 200, "OK", "text/css", css);
            } else {
                send_404(client_socket);
            }
        } else if (strncmp(path, "/app.js", 7) == 0) {
            std::string js = read_file((std::string(WEB_ROOT) + "/app.js").c_str());
            if (!js.empty()) {
                send_response(client_socket, 200, "OK", "application/javascript", js);
            } else {
                send_404(client_socket);
            }
        } else {
            send_404(client_socket);
        }
    } else if (strcmp(method, "POST") == 0) {
        if (strcmp(path, "/api/config") == 0) {
            handle_save_config(client_socket, body);
        } else if (strcmp(path, "/api/stress/cpu/start") == 0) {
            handle_stress_cpu_start(client_socket, body);
        } else if (strcmp(path, "/api/stress/cpu/stop") == 0) {
            handle_stress_cpu_stop(client_socket);
        } else if (strcmp(path, "/api/stress/memory/start") == 0) {
            handle_stress_memory_start(client_socket, body);
        } else if (strcmp(path, "/api/stress/memory/stop") == 0) {
            handle_stress_memory_stop(client_socket);
        } else if (strcmp(path, "/api/stress/disk/start") == 0) {
            handle_stress_disk_start(client_socket, body);
        } else if (strcmp(path, "/api/stress/disk/stop") == 0) {
            handle_stress_disk_stop(client_socket);
        } else if (strcmp(path, "/api/stress/network/start") == 0) {
            handle_stress_network_start(client_socket, body);
        } else if (strcmp(path, "/api/stress/network/stop") == 0) {
            handle_stress_network_stop(client_socket);
        } else if (strcmp(path, "/api/stress/thermal/start") == 0) {
            handle_stress_thermal_start(client_socket, body);
        } else if (strcmp(path, "/api/stress/thermal/stop") == 0) {
            handle_stress_thermal_stop(client_socket);
        } else if (strcmp(path, "/api/stress/stop-all") == 0) {
            handle_stress_stop_all(client_socket);
        } else if (strcmp(path, "/api/cpu/freq/set") == 0) {
            handle_cpu_freq_set(client_socket, body);
        } else if (strcmp(path, "/api/cpu/freq/restore") == 0) {
            handle_cpu_freq_restore(client_socket);
        } else {
            send_404(client_socket);
        }
    } else if (strcmp(method, "OPTIONS") == 0) {
        // CORS preflight - need to include all required headers
        std::stringstream response;
        response << "HTTP/1.1 200 OK\r\n";
        response << "Access-Control-Allow-Origin: *\r\n";
        response << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n";
        response << "Access-Control-Allow-Headers: Content-Type, Accept\r\n";
        response << "Access-Control-Max-Age: 86400\r\n";
        response << "Content-Length: 0\r\n";
        response << "Connection: close\r\n";
        response << "\r\n";
        std::string resp = response.str();
        send(client_socket, resp.c_str(), resp.length(), 0);
    } else {
        send_response(client_socket, 405, "Method Not Allowed", "text/plain", "Method not allowed");
    }

    close(client_socket);
    return nullptr;
}

int main() {
    // Set up signal handlers
    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    LOGD("Starting DANR configuration web server on port %d", PORT);

    int server_socket = socket(AF_INET, SOCK_STREAM, 0);
    if (server_socket < 0) {
        LOGE("Failed to create socket");
        return 1;
    }

    // Allow port reuse
    int opt = 1;
    setsockopt(server_socket, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = INADDR_ANY;
    server_addr.sin_port = htons(PORT);

    if (bind(server_socket, (struct sockaddr*)&server_addr, sizeof(server_addr)) < 0) {
        LOGE("Failed to bind to port %d", PORT);
        close(server_socket);
        return 1;
    }

    if (listen(server_socket, 10) < 0) {
        LOGE("Failed to listen on socket");
        close(server_socket);
        return 1;
    }

    LOGD("Server listening on http://localhost:%d", PORT);
    LOGD("Open http://localhost:%d in your browser to configure DANR", PORT);

    while (keep_running) {
        struct sockaddr_in client_addr;
        socklen_t client_len = sizeof(client_addr);

        int* client_socket = (int*)malloc(sizeof(int));
        *client_socket = accept(server_socket, (struct sockaddr*)&client_addr, &client_len);

        if (*client_socket < 0) {
            free(client_socket);
            if (keep_running) {
                LOGE("Failed to accept connection");
            }
            continue;
        }

        // Handle in new thread
        pthread_t thread;
        pthread_create(&thread, nullptr, handle_client, client_socket);
        pthread_detach(thread);
    }

    close(server_socket);
    LOGD("Server stopped");
    return 0;
}
