import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface ThreadInfo {
  name: string;
  id: number;
  state: string;
  stackTrace: string[];
  isMainThread: boolean;
}

export interface DeviceInfo {
  manufacturer: string;
  model: string;
  osVersion: string;
  sdkVersion: number;
  totalRam: number;
  availableRam: number;
}

export interface AppInfo {
  packageName: string;
  versionName: string;
  versionCode: number;
  isInForeground: boolean;
}

export interface ANR {
  _id: string;
  timestamp: string;
  duration: number;
  mainThread: ThreadInfo;
  allThreads: ThreadInfo[];
  deviceInfo: DeviceInfo;
  appInfo: AppInfo;
  stackTraceHash: string;
  groupId?: string;
  occurrenceCount: number;
  firstOccurrence: string;
  lastOccurrence: string;
}

export interface ANRGroup {
  _id: string;
  stackTracePattern: string;
  stackTraceHash: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  anrIds: string[];
  similarity: number;
}

export interface ANRFilters {
  deviceModel?: string;
  osVersion?: string;
  startDate?: string;
  endDate?: string;
  isMainThread?: boolean;
  sort?: string;
  limit?: number;
  skip?: number;
}

export const anrApi = {
  getAll: async (filters?: ANRFilters) => {
    const response = await api.get('/api/anrs', { params: filters });
    return response.data;
  },

  getById: async (id: string) => {
    const response = await api.get(`/api/anrs/${id}`);
    return response.data;
  },

  delete: async (id: string) => {
    const response = await api.delete(`/api/anrs/${id}`);
    return response.data;
  },

  deleteAll: async () => {
    const response = await api.delete('/api/anrs');
    return response.data;
  },

  getGroups: async () => {
    const response = await api.get('/api/anrs/groups/all');
    return response.data;
  },
};

// Profile Session Types
export interface ProfileSession {
  _id: string;
  deviceId: string;
  sessionId: string;
  startTime: string;
  endTime: string;
  samplingIntervalMs: number;
  totalSamples: number;
  hasRoot: boolean;
  profilerType: 'java' | 'simpleperf';
  createdAt: string;
  updatedAt: string;
}

export interface FlameGraphNode {
  name: string;
  value: number;
  children: FlameGraphNode[];
}

export interface FlameGraphThread {
  threadName: string;
  threadId: number;
  sampleCount: number;
  root: FlameGraphNode;
}

export interface FlameGraphData {
  sessionId: string;
  totalSamples: number;
  threads: FlameGraphThread[];
}

export interface TopFunction {
  name: string;
  count: number;
  percentage: number;
}

export interface ThreadSummary {
  threadName: string;
  threadId: number;
  avgCpuUsage: number | null;
  states: { state: string; count: number }[];
}

export interface ProfileFilters {
  deviceId?: string;
  limit?: number;
  skip?: number;
  sort?: string;
}

export const profileApi = {
  getAll: async (filters?: ProfileFilters) => {
    const response = await api.get('/api/profiles', { params: filters });
    return response.data;
  },

  getById: async (sessionId: string, includeSamples: boolean = false) => {
    const response = await api.get(`/api/profiles/${sessionId}`, {
      params: { includeSamples: includeSamples.toString() }
    });
    return response.data;
  },

  getFlameGraph: async (sessionId: string, threadFilter?: string) => {
    const response = await api.get(`/api/profiles/${sessionId}/flamegraph`, {
      params: threadFilter ? { thread: threadFilter } : undefined
    });
    return response.data;
  },

  getTopFunctions: async (sessionId: string, limit: number = 20) => {
    const response = await api.get(`/api/profiles/${sessionId}/top-functions`, {
      params: { limit }
    });
    return response.data;
  },

  getThreadSummary: async (sessionId: string) => {
    const response = await api.get(`/api/profiles/${sessionId}/thread-summary`);
    return response.data;
  },

  getPerfettoExport: async (sessionId: string, minified: boolean = false) => {
    const response = await api.get(`/api/profiles/${sessionId}/perfetto`, {
      params: { minified: minified.toString() },
      responseType: 'blob'
    });
    return response.data;
  },

  getRawTrace: async (sessionId: string) => {
    const response = await api.get(`/api/profiles/${sessionId}/trace`, {
      responseType: 'blob'
    });
    return response.data;
  },

  delete: async (sessionId: string) => {
    const response = await api.delete(`/api/profiles/${sessionId}`);
    return response.data;
  },

  deleteAll: async () => {
    const response = await api.delete('/api/profiles');
    return response.data;
  },
};

export default api;
