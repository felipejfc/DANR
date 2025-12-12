import { io, Socket } from 'socket.io-client';

export interface Device {
  id: string;
  model: string;
  androidVersion: string;
  hasRoot: boolean;
  cpuInfo?: {
    cores: number;
    currentMaxFreq: number;
    originalMaxFreq: number;
    availableFreqs: number[];
  };
  ipAddress?: string;
  connectedAt: string;
  lastSeen: string;
}

export interface CommandResponse {
  success: boolean;
  message?: string;
  data?: any;
}

class SocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  connect() {
    // Return existing socket if it already exists (connected or connecting)
    if (this.socket) {
      return this.socket;
    }

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
    this.socket = io(backendUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    this.socket.on('connect', () => {
      console.log('Connected to backend WebSocket');
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from backend WebSocket');
    });

    this.socket.on('devices:updated', (data) => {
      this.emit('devices:updated', data);
    });

    this.socket.on('ui:devices', (data) => {
      this.emit('devices:updated', data);
    });

    this.socket.on('device:response', (data) => {
      this.emit('device:response', data);
    });

    this.socket.on('ui:command_error', (data) => {
      this.emit('ui:command_error', data);
    });

    this.socket.on('device:status_update', (data) => {
      this.emit('device:status_update', data);
    });

    this.socket.on('stress:status', (data) => {
      this.emit('stress:status', data);
    });

    return this.socket;
  }

  private createRequestId(): string {
    try {
      const cryptoObj = (globalThis as unknown as { crypto?: unknown }).crypto;
      if (cryptoObj && typeof (cryptoObj as { randomUUID?: unknown }).randomUUID === 'function') {
        return (cryptoObj as { randomUUID: () => string }).randomUUID();
      }
    } catch {
      // Ignore and fall back
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (data: any) => void) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }

  sendCommand(deviceId: string, command: string, params?: any): Promise<CommandResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      const requestId = this.createRequestId();
      const timeout = setTimeout(() => {
        this.socket?.off('device:response', responseHandler);
        this.socket?.off('ui:command_error', commandErrorHandler);
        reject(new Error('Command timeout'));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeout);
        this.socket?.off('device:response', responseHandler);
        this.socket?.off('ui:command_error', commandErrorHandler);
      };

      const responseHandler = (data: any) => {
        const responseRequestId = data?.command?.requestId ?? data?.requestId;
        if (data?.deviceId === deviceId && responseRequestId === requestId) {
          cleanup();
          resolve(data.response as CommandResponse);
        }
      };

      const commandErrorHandler = (data: any) => {
        if (data?.deviceId !== deviceId) return;
        if (data?.requestId !== requestId) return;
        cleanup();
        resolve({
          success: false,
          message: data?.message || 'Command failed',
          data: data,
        });
      };

      this.socket.on('device:response', responseHandler);
      this.socket.on('ui:command_error', commandErrorHandler);
      this.socket.emit('ui:command', { deviceId, requestId, command, params });
    });
  }

  async setCPUFrequency(deviceId: string, frequency: number, cores?: number[]): Promise<CommandResponse> {
    return this.sendCommand(deviceId, 'set_cpu_freq', { frequency, cores });
  }

  async restoreCPU(deviceId: string): Promise<CommandResponse> {
    return this.sendCommand(deviceId, 'restore_cpu');
  }

  async triggerANR(deviceId: string, type: string, durationMs: number = 10000): Promise<CommandResponse> {
    // Include both "durationMs" (preferred) and "duration" (legacy) for compatibility.
    return this.sendCommand(deviceId, 'trigger_anr', { type, durationMs, duration: durationMs });
  }

  async toggleCore(deviceId: string, core: number, enable: boolean): Promise<CommandResponse> {
    return this.sendCommand(deviceId, 'toggle_core', { coreId: core, enabled: enable });
  }

  async getStatus(deviceId: string): Promise<CommandResponse> {
    return this.sendCommand(deviceId, 'get_status');
  }

  requestDeviceList() {
    if (this.socket?.connected) {
      this.socket.emit('ui:get_devices');
    }
  }

  async startStressTest(
    deviceId: string,
    type: 'cpu' | 'memory' | 'disk_io',
    config: {
      threadCount?: number;
      loadPercentage?: number;
      targetMemoryMB?: number;
      throughputMBps?: number;
      durationMs?: number;
    } = {}
  ): Promise<CommandResponse> {
    return this.sendCommand(deviceId, 'start_stress_test', { type, ...config });
  }

  async stopStressTest(deviceId: string, type?: 'cpu' | 'memory' | 'disk_io' | 'all'): Promise<CommandResponse> {
    return this.sendCommand(deviceId, 'stop_stress_test', { type: type || 'all' });
  }

  async getStressStatus(deviceId: string): Promise<CommandResponse> {
    return this.sendCommand(deviceId, 'get_stress_status');
  }
}

export const socketService = new SocketService();
