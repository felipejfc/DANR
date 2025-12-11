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

export default api;
