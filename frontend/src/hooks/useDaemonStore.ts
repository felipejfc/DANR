import { useCallback, useSyncExternalStore } from 'react';
import { stressApi, ModuleConfig, PackageInfo, AllStressStatus, CPUFreqStatus } from '@/lib/stressApi';

interface DaemonConnection {
  isConnected: boolean;
  isConnecting: boolean;
  autoConnectAttempted: boolean; // Track if we've already tried auto-connect
  url: string;
  config: ModuleConfig | null;
  packages: PackageInfo[];
  stressStatus: AllStressStatus | null;
  cpuFreqStatus: CPUFreqStatus | null;
}

interface DaemonStore {
  connections: Record<string, DaemonConnection>;
  listeners: Set<() => void>;
}

const defaultConnection: DaemonConnection = {
  isConnected: false,
  isConnecting: false,
  autoConnectAttempted: false,
  url: '',
  config: null,
  packages: [],
  stressStatus: null,
  cpuFreqStatus: null,
};

// Global store - persists across component mounts
const store: DaemonStore = {
  connections: {},
  listeners: new Set(),
};

// Polling intervals per device
const pollingIntervals: Record<string, NodeJS.Timeout> = {};

// localStorage key for persisted URLs
const STORAGE_KEY = 'daemon_urls';

// Standalone device ID - must match the one used in devices/page.tsx
const STANDALONE_DEVICE_ID = 'standalone-daemon';

function getPersistedUrls(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function persistUrl(deviceId: string, url: string) {
  if (typeof window === 'undefined') return;
  try {
    const urls = getPersistedUrls();
    urls[deviceId] = url;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(urls));
  } catch {
    // localStorage not available
  }
}

function getPersistedUrl(deviceId: string): string | null {
  const urls = getPersistedUrls();
  return urls[deviceId] || null;
}

function removePersistedUrl(deviceId: string) {
  if (typeof window === 'undefined') return;
  try {
    const urls = getPersistedUrls();
    delete urls[deviceId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(urls));
  } catch {
    // localStorage not available
  }
}

function notifyListeners() {
  store.listeners.forEach((listener) => listener());
}

function getConnection(deviceId: string): DaemonConnection {
  return store.connections[deviceId] || defaultConnection;
}

function setConnection(deviceId: string, updates: Partial<DaemonConnection>) {
  store.connections[deviceId] = {
    ...getConnection(deviceId),
    ...updates,
  };
  notifyListeners();
}

async function connectToDaemon(deviceId: string, url: string): Promise<boolean> {
  const currentConnection = getConnection(deviceId);

  // Already connected to this URL
  if (currentConnection.isConnected && currentConnection.url === url) {
    return true;
  }

  setConnection(deviceId, { isConnecting: true });

  try {
    stressApi.setDeviceUrl(url);
    const config = await stressApi.getConfig();

    let packages: PackageInfo[] = [];
    try {
      packages = await stressApi.getPackages();
    } catch {
      // Packages fetch is optional
    }

    setConnection(deviceId, {
      isConnected: true,
      isConnecting: false,
      url,
      config,
      packages,
    });

    // Persist the URL for future sessions
    persistUrl(deviceId, url);

    // Start polling for stress status
    startPolling(deviceId);

    return true;
  } catch (error) {
    setConnection(deviceId, {
      isConnected: false,
      isConnecting: false,
      url: '',
    });
    return false;
  }
}

function disconnectDaemon(deviceId: string) {
  stopPolling(deviceId);
  setConnection(deviceId, {
    isConnected: false,
    isConnecting: false,
    autoConnectAttempted: false, // Reset so manual connection can work again
    url: '',
    config: null,
    packages: [],
    stressStatus: null,
    cpuFreqStatus: null,
  });
  // Remove the persisted URL so auto-connect doesn't reconnect on page refresh
  removePersistedUrl(deviceId);
}

function startPolling(deviceId: string) {
  stopPolling(deviceId); // Clear any existing interval

  const poll = async () => {
    const connection = getConnection(deviceId);
    if (!connection.isConnected) {
      stopPolling(deviceId);
      return;
    }

    try {
      stressApi.setDeviceUrl(connection.url);

      // Fetch stress status and CPU freq status in parallel
      const [stressStatus, cpuFreqStatus] = await Promise.all([
        stressApi.getStatus().catch(() => null),
        stressApi.getCpuFreqStatus().catch(() => null),
      ]);

      const updates: Partial<DaemonConnection> = {};
      if (stressStatus) updates.stressStatus = stressStatus;
      if (cpuFreqStatus) updates.cpuFreqStatus = cpuFreqStatus;

      if (Object.keys(updates).length > 0) {
        setConnection(deviceId, updates);
      }
    } catch {
      // Silently fail - daemon may be temporarily unavailable
    }
  };

  poll(); // Initial poll
  pollingIntervals[deviceId] = setInterval(poll, 2000);
}

function stopPolling(deviceId: string) {
  if (pollingIntervals[deviceId]) {
    clearInterval(pollingIntervals[deviceId]);
    delete pollingIntervals[deviceId];
  }
}

async function updateConfig(deviceId: string, config: ModuleConfig): Promise<boolean> {
  const connection = getConnection(deviceId);
  if (!connection.isConnected) return false;

  try {
    stressApi.setDeviceUrl(connection.url);
    await stressApi.saveConfig(config);
    setConnection(deviceId, { config });
    return true;
  } catch {
    return false;
  }
}

async function refreshPackages(deviceId: string): Promise<PackageInfo[]> {
  const connection = getConnection(deviceId);
  if (!connection.isConnected) return [];

  try {
    stressApi.setDeviceUrl(connection.url);
    const packages = await stressApi.getPackages();
    setConnection(deviceId, { packages });
    return packages;
  } catch {
    return connection.packages;
  }
}

async function fetchLogs(deviceId: string): Promise<string> {
  const connection = getConnection(deviceId);
  if (!connection.isConnected) return '';

  try {
    stressApi.setDeviceUrl(connection.url);
    return await stressApi.getLogs();
  } catch {
    return '';
  }
}

// Hook to use daemon store
export function useDaemonConnection(deviceId: string) {
  const subscribe = useCallback(
    (callback: () => void) => {
      store.listeners.add(callback);
      return () => store.listeners.delete(callback);
    },
    []
  );

  const getSnapshot = useCallback(() => {
    return getConnection(deviceId);
  }, [deviceId]);

  const connection = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const connect = useCallback(
    (url: string) => connectToDaemon(deviceId, url),
    [deviceId]
  );

  const disconnect = useCallback(() => disconnectDaemon(deviceId), [deviceId]);

  const saveConfig = useCallback(
    (config: ModuleConfig) => updateConfig(deviceId, config),
    [deviceId]
  );

  const refreshPkgs = useCallback(
    () => refreshPackages(deviceId),
    [deviceId]
  );

  const getLogs = useCallback(
    () => fetchLogs(deviceId),
    [deviceId]
  );

  // Set the stress API URL whenever we access this connection
  if (connection.isConnected && connection.url) {
    stressApi.setDeviceUrl(connection.url);
  }

  return {
    ...connection,
    connect,
    disconnect,
    saveConfig,
    refreshPackages: refreshPkgs,
    fetchLogs: getLogs,
  };
}

// Auto-connect helper - call this when a device appears
export async function autoConnectDaemon(deviceId: string, ipAddress: string | undefined): Promise<boolean> {
  const connection = getConnection(deviceId);

  // Don't retry if already connected, connecting, or already attempted
  if (connection.isConnected || connection.isConnecting || connection.autoConnectAttempted) {
    return connection.isConnected;
  }

  // Mark that we've attempted auto-connect (only try once)
  setConnection(deviceId, { autoConnectAttempted: true });

  // Check if standalone daemon is already connected
  // This allows SDK devices to pick up an existing standalone connection
  // We use whatever URL standalone has - the device IP might be NAT'd
  if (deviceId !== STANDALONE_DEVICE_ID) {
    const standaloneConnection = getConnection(STANDALONE_DEVICE_ID);
    if (standaloneConnection.isConnected && standaloneConnection.url) {
      const success = await connectToDaemon(deviceId, standaloneConnection.url);
      if (success) return true;
    }
  }

  // First try persisted URL (from previous successful connection)
  const persistedUrl = getPersistedUrl(deviceId);
  if (persistedUrl) {
    const success = await connectToDaemon(deviceId, persistedUrl);
    if (success) return true;
  }

  // Fall back to device IP address
  if (ipAddress) {
    const url = `http://${ipAddress}:8765`;
    return connectToDaemon(deviceId, url);
  }

  return false;
}
