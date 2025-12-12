import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { deviceRegistry, Device, CPUInfo } from './deviceRegistry';

export interface Command {
  type:
    | 'set_cpu_freq'
    | 'restore_cpu'
    | 'trigger_anr'
    | 'toggle_core'
    | 'get_status'
    | 'start_stress_test'
    | 'stop_stress_test'
    | 'get_stress_status';
  params?: any;
  requestId?: string;
}

export interface CommandResponse {
  success: boolean;
  message?: string;
  data?: any;
}

function isCommandType(command: string): command is Command['type'] {
  switch (command) {
    case 'set_cpu_freq':
    case 'restore_cpu':
    case 'trigger_anr':
    case 'toggle_core':
    case 'get_status':
    case 'start_stress_test':
    case 'stop_stress_test':
    case 'get_stress_status':
      return true;
    default:
      return false;
  }
}

export function setupDeviceSocket(httpServer: HTTPServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[UI/Device] Socket connected: ${socket.id}`);

    // Send current device list to newly connected client (this is for UI clients)
    socket.emit('devices:updated', {
      devices: deviceRegistry.getAllDevices().map(serializeDevice),
    });

    // Device registration
    socket.on('device:register', (deviceInfo: {
      deviceId: string;
      model: string;
      androidVersion: string;
      hasRoot: boolean;
      cpuInfo?: CPUInfo;
    }) => {
      console.log('Device registering:', deviceInfo);

      // Extract IP from socket (requires network_mode: host in Docker)
      let ipAddress = socket.handshake.address;
      // Handle IPv6 mapped IPv4 addresses (::ffff:192.168.1.1)
      if (ipAddress && ipAddress.startsWith('::ffff:')) {
        ipAddress = ipAddress.substring(7);
      }
      console.log('Device IP address:', ipAddress);

      // Map deviceId to id for the registry
      deviceRegistry.register(socket, {
        id: deviceInfo.deviceId,
        model: deviceInfo.model,
        androidVersion: deviceInfo.androidVersion,
        hasRoot: deviceInfo.hasRoot,
        cpuInfo: deviceInfo.cpuInfo,
        ipAddress: ipAddress,
      });

      // Send registration confirmation
      socket.emit('device:registered', {
        success: true,
        message: 'Device registered successfully',
      });

      // Notify all connected clients about new device
      io.emit('devices:updated', {
        devices: deviceRegistry.getAllDevices().map(serializeDevice),
      });
    });

    // Device status update
    socket.on('device:status', (data: { deviceId: string; cpuInfo?: CPUInfo }) => {
      deviceRegistry.updateLastSeen(data.deviceId);

      if (data.cpuInfo) {
        deviceRegistry.updateCPUInfo(data.deviceId, data.cpuInfo);
      }

      // Broadcast status update to UI clients
      io.emit('device:status_update', {
        deviceId: data.deviceId,
        cpuInfo: data.cpuInfo,
        timestamp: new Date(),
      });
    });

    // Command from UI to device
    socket.on('ui:command', async (data: { deviceId: string; requestId?: string; command: string; params?: any }) => {
      const device = deviceRegistry.getDevice(data.deviceId);

      if (!device) {
        socket.emit('ui:command_error', {
          success: false,
          message: `Device ${data.deviceId} not found or not connected`,
          deviceId: data.deviceId,
          requestId: data.requestId,
          command: data.command,
        });
        return;
      }

      if (!isCommandType(data.command)) {
        socket.emit('ui:command_error', {
          success: false,
          message: `Unknown command: ${data.command}`,
          deviceId: data.deviceId,
          requestId: data.requestId,
          command: data.command,
        });
        return;
      }

      // Format command for device
      const commandPayload: Command = {
        type: data.command,
        params: data.params,
        requestId: data.requestId,
      };

      // Forward command to device
      device.socket.emit('device:command', commandPayload);

      console.log(`Command sent to device ${data.deviceId}:`, data.command);
    });

    // Command response from device
    socket.on('device:response', (data: {
      deviceId: string;
      response: CommandResponse;
      command: Command;
    }) => {
      console.log(`Response from device ${data.deviceId}:`, data.response);

      // Broadcast response to all UI clients
      io.emit('device:response', {
        deviceId: data.deviceId,
        command: data.command,
        response: data.response,
        requestId: data.command?.requestId,
        timestamp: new Date(),
      });
    });

    // Get all devices (from UI)
    socket.on('ui:get_devices', () => {
      const devices = deviceRegistry.getAllDevices().map(serializeDevice);
      socket.emit('ui:devices', { devices });
    });

    // Stress status update from device
    socket.on('stress:status', (data: { deviceId: string; stressStatuses: any[] }) => {
      console.log(`Stress status update from device ${data.deviceId}`);

      // Broadcast to all UI clients
      io.emit('stress:status', {
        deviceId: data.deviceId,
        stressStatuses: data.stressStatuses,
        timestamp: new Date(),
      });
    });

    // Disconnect handling
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);

      // Find and unregister device
      const devices = deviceRegistry.getAllDevices();
      const disconnectedDevice = devices.find(d => d.socket.id === socket.id);

      if (disconnectedDevice) {
        deviceRegistry.unregister(disconnectedDevice.id);

        // Notify all clients about device disconnection
        io.emit('devices:updated', {
          devices: deviceRegistry.getAllDevices().map(serializeDevice),
        });
      }
    });
  });

  return io;
}

// Serialize device for sending to clients (remove socket reference)
function serializeDevice(device: Device) {
  return {
    id: device.id,
    model: device.model,
    androidVersion: device.androidVersion,
    hasRoot: device.hasRoot,
    cpuInfo: device.cpuInfo,
    ipAddress: device.ipAddress,
    connectedAt: device.connectedAt,
    lastSeen: device.lastSeen,
    connected: true,
  };
}
