import { Socket } from 'socket.io';

export interface CPUInfo {
  cores: number;
  currentMaxFreq: number;
  originalMaxFreq: number;
  availableFreqs: number[];
}

export interface Device {
  id: string;
  socket: Socket;
  model: string;
  androidVersion: string;
  hasRoot: boolean;
  cpuInfo?: CPUInfo;
  connectedAt: Date;
  lastSeen: Date;
}

class DeviceRegistry {
  private devices: Map<string, Device> = new Map();

  register(socket: Socket, deviceInfo: Omit<Device, 'socket' | 'connectedAt' | 'lastSeen'>): void {
    const device: Device = {
      ...deviceInfo,
      socket,
      connectedAt: new Date(),
      lastSeen: new Date(),
    };

    this.devices.set(deviceInfo.id, device);
    console.log(`Device registered: ${deviceInfo.id} (${deviceInfo.model})`);
  }

  unregister(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      this.devices.delete(deviceId);
      console.log(`Device unregistered: ${deviceId}`);
    }
  }

  getDevice(deviceId: string): Device | undefined {
    return this.devices.get(deviceId);
  }

  getAllDevices(): Device[] {
    return Array.from(this.devices.values());
  }

  updateLastSeen(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeen = new Date();
    }
  }

  updateCPUInfo(deviceId: string, cpuInfo: CPUInfo): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.cpuInfo = cpuInfo;
    }
  }

  isConnected(deviceId: string): boolean {
    return this.devices.has(deviceId);
  }

  getDeviceCount(): number {
    return this.devices.size;
  }
}

export const deviceRegistry = new DeviceRegistry();
