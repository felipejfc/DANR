// Stress API client for the daemon webserver
// Note: This connects directly to the device's daemon on port 8765

export interface StressStatus {
  type: string;
  isRunning: boolean;
  remainingTimeMs: number;
  data: Record<string, string>;
}

export interface AllStressStatus {
  cpu: StressStatus;
  memory: StressStatus;
  disk_io: StressStatus;
  network: StressStatus;
  thermal: StressStatus;
}

export interface CPUStressConfig {
  threadCount?: number;
  loadPercentage?: number;
  durationMs?: number;
  pinToCores?: boolean;
}

export interface MemoryStressConfig {
  targetFreeMB?: number;
  chunkSizeMB?: number;
  durationMs?: number;
  useAnonymousMmap?: boolean;
  lockMemory?: boolean;
}

export interface DiskStressConfig {
  throughputMBps?: number;
  chunkSizeKB?: number;
  durationMs?: number;
  testPath?: string;
  useDirectIO?: boolean;
  syncWrites?: boolean;
}

export interface NetworkStressConfig {
  bandwidthLimitKbps?: number;
  latencyMs?: number;
  packetLossPercent?: number;
  durationMs?: number;
  targetInterface?: string;
}

export interface ThermalStressConfig {
  disableThermalThrottling?: boolean;
  maxFrequencyPercent?: number;
  forceAllCoresOnline?: boolean;
  durationMs?: number;
}

// Configuration types
export interface DanrConfig {
  backendUrl: string;
  anrThresholdMs: number;
  enableInRelease: boolean;
  enableInDebug: boolean;
  autoStart: boolean;
}

export interface ModuleConfig {
  whitelist: string[];
  danrConfig: DanrConfig;
}

export interface PackageInfo {
  package: string;
  label?: string;
}

interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: AllStressStatus;
}

class StressApiClient {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    // Default to empty, will be set when connecting to a device
    this.baseUrl = '';
    this.timeout = 5000; // 5 second timeout
  }

  setDeviceUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, '');
  }

  getDeviceUrl(): string {
    return this.baseUrl;
  }

  setTimeout(timeoutMs: number) {
    this.timeout = timeoutMs;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    if (!this.baseUrl) {
      throw new Error('Device URL not set. Call setDeviceUrl first.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms - daemon may be unresponsive`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getStatus(): Promise<AllStressStatus> {
    const response = await this.request<ApiResponse>('/api/stress/status');
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to get status');
    }
    return response.data;
  }

  // CPU stress
  async startCpu(config: CPUStressConfig = {}): Promise<void> {
    const response = await this.request<ApiResponse>('/api/stress/cpu/start', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to start CPU stress');
    }
  }

  async stopCpu(): Promise<void> {
    const response = await this.request<ApiResponse>('/api/stress/cpu/stop', {
      method: 'POST',
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to stop CPU stress');
    }
  }

  // Memory stress
  async startMemory(config: MemoryStressConfig = {}): Promise<void> {
    const response = await this.request<ApiResponse>('/api/stress/memory/start', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to start memory stress');
    }
  }

  async stopMemory(): Promise<void> {
    const response = await this.request<ApiResponse>('/api/stress/memory/stop', {
      method: 'POST',
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to stop memory stress');
    }
  }

  // Disk stress
  async startDisk(config: DiskStressConfig = {}): Promise<void> {
    const response = await this.request<ApiResponse>('/api/stress/disk/start', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to start disk stress');
    }
  }

  async stopDisk(): Promise<void> {
    const response = await this.request<ApiResponse>('/api/stress/disk/stop', {
      method: 'POST',
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to stop disk stress');
    }
  }

  // Network stress
  async startNetwork(config: NetworkStressConfig = {}): Promise<void> {
    const response = await this.request<ApiResponse>('/api/stress/network/start', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to start network stress');
    }
  }

  async stopNetwork(): Promise<void> {
    const response = await this.request<ApiResponse>('/api/stress/network/stop', {
      method: 'POST',
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to stop network stress');
    }
  }

  // Thermal stress
  async startThermal(config: ThermalStressConfig = {}): Promise<void> {
    const response = await this.request<ApiResponse>('/api/stress/thermal/start', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to start thermal stress');
    }
  }

  async stopThermal(): Promise<void> {
    const response = await this.request<ApiResponse>('/api/stress/thermal/stop', {
      method: 'POST',
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to stop thermal stress');
    }
  }

  // Stop all
  async stopAll(): Promise<void> {
    const response = await this.request<ApiResponse>('/api/stress/stop-all', {
      method: 'POST',
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to stop all stress tests');
    }
  }

  // Configuration API methods
  async getConfig(): Promise<ModuleConfig> {
    return this.request<ModuleConfig>('/api/config');
  }

  async saveConfig(config: ModuleConfig): Promise<void> {
    const response = await this.request<{ success: boolean; message?: string; error?: string }>('/api/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to save configuration');
    }
  }

  async getPackages(): Promise<PackageInfo[]> {
    return this.request<PackageInfo[]>('/api/packages');
  }

  async getLogs(): Promise<string> {
    if (!this.baseUrl) {
      throw new Error('Device URL not set. Call setDeviceUrl first.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/logs`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.text();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms - daemon may be unresponsive`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const stressApi = new StressApiClient();
export default stressApi;
