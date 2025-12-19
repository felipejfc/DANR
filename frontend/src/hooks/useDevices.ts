import { useEffect, useState } from 'react';
import { socketService, Device } from '@/lib/socket';

export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = socketService.connect();

    const handleConnect = () => {
      setIsConnected(true);
    };

    const handleDisconnect = () => {
      setIsConnected(false);
    };

    const handleDevicesUpdate = (data: { devices: Device[] }) => {
      console.log('[useDevices] devices:updated received, device count:', data.devices.length, 'ids:', data.devices.map(d => d.id));
      setDevices(data.devices);
    };

    const handleStatusUpdate = (data: { deviceId: string; cpuInfo: any }) => {
      setDevices((prevDevices) =>
        prevDevices.map((device) =>
          device.id === data.deviceId
            ? { ...device, cpuInfo: data.cpuInfo }
            : device
        )
      );
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socketService.on('devices:updated', handleDevicesUpdate);
    socketService.on('device:status_update', handleStatusUpdate);

    setIsConnected(socket.connected);

    // Request device list after subscribing to events
    if (socket.connected) {
      socketService.requestDeviceList();
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socketService.off('devices:updated', handleDevicesUpdate);
      socketService.off('device:status_update', handleStatusUpdate);
    };
  }, []);

  return { devices, isConnected };
}
