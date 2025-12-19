import mongoose, { Schema, Document } from 'mongoose';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

// Profile data directory - mounted as volume in Docker
const PROFILE_DATA_DIR = process.env.PROFILE_DATA_DIR || '/data/profiles';

// Ensure directory exists
if (!fs.existsSync(PROFILE_DATA_DIR)) {
  fs.mkdirSync(PROFILE_DATA_DIR, { recursive: true });
}

export interface IThreadCPUTime {
  userTimeJiffies: number;
  kernelTimeJiffies: number;
  cpuUsagePercent?: number;
}

export interface ISystemCPUInfo {
  userPercent: number;
  systemPercent: number;
  iowaitPercent: number;
}

export interface IThreadSnapshot {
  threadId: number;
  threadName: string;
  state: string;
  stackFrames: string[];
  isMainThread: boolean;
  cpuTime?: IThreadCPUTime;
}

export interface IProfileSample {
  timestamp: number;
  threads: IThreadSnapshot[];
  systemCPU?: ISystemCPUInfo;
}

export interface IProfileSession extends Document {
  deviceId: string;
  sessionId: string;
  startTime: Date;
  endTime: Date;
  samplingIntervalMs: number;
  totalSamples: number;
  hasRoot: boolean;
  profilerType: 'java' | 'simpleperf';  // Type of profiler used
  samplesFile: string;  // Path to samples file on disk
  createdAt: Date;
  updatedAt: Date;
}

// Get the file path for a session's samples
function getSamplesFilePath(sessionId: string): string {
  return path.join(PROFILE_DATA_DIR, `${sessionId}.samples.gz`);
}

// Get the file path for raw Perfetto trace
function getTraceFilePath(sessionId: string): string {
  return path.join(PROFILE_DATA_DIR, `${sessionId}.perfetto-trace`);
}

// Save samples to disk (gzip compressed)
export function saveSamplesToDisk(sessionId: string, samples: IProfileSample[]): string {
  const filePath = getSamplesFilePath(sessionId);
  const json = JSON.stringify(samples);
  const compressed = zlib.gzipSync(json);
  fs.writeFileSync(filePath, compressed);
  console.log(`[ProfileSession] Saved ${samples.length} samples to ${filePath} (${compressed.length} bytes)`);
  return filePath;
}

// Save raw Perfetto trace to disk (from base64)
export function saveTraceDataToDisk(sessionId: string, traceDataBase64: string): string {
  const filePath = getTraceFilePath(sessionId);
  const traceBuffer = Buffer.from(traceDataBase64, 'base64');
  fs.writeFileSync(filePath, traceBuffer);
  console.log(`[ProfileSession] Saved raw Perfetto trace to ${filePath} (${traceBuffer.length} bytes)`);
  return filePath;
}

// Load samples from disk
export function loadSamplesFromDisk(sessionId: string): IProfileSample[] {
  const filePath = getSamplesFilePath(sessionId);
  if (!fs.existsSync(filePath)) {
    console.warn(`[ProfileSession] Samples file not found: ${filePath}`);
    return [];
  }
  const compressed = fs.readFileSync(filePath);
  const json = zlib.gunzipSync(compressed).toString('utf8');
  return JSON.parse(json);
}

// Load raw Perfetto trace from disk (returns base64)
export function loadTraceDataFromDisk(sessionId: string): string | null {
  const filePath = getTraceFilePath(sessionId);
  if (!fs.existsSync(filePath)) {
    console.warn(`[ProfileSession] Trace file not found: ${filePath}`);
    return null;
  }
  const traceBuffer = fs.readFileSync(filePath);
  return traceBuffer.toString('base64');
}

// Get raw trace file path if it exists
export function getTraceFilePathIfExists(sessionId: string): string | null {
  const filePath = getTraceFilePath(sessionId);
  return fs.existsSync(filePath) ? filePath : null;
}

// Delete samples file from disk
export function deleteSamplesFromDisk(sessionId: string): void {
  const filePath = getSamplesFilePath(sessionId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  // Also delete trace file if exists
  const traceFilePath = getTraceFilePath(sessionId);
  if (fs.existsSync(traceFilePath)) {
    fs.unlinkSync(traceFilePath);
  }
}

const ProfileSessionSchema = new Schema<IProfileSession>({
  deviceId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true, unique: true, index: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  samplingIntervalMs: { type: Number, required: true },
  totalSamples: { type: Number, required: true },
  hasRoot: { type: Boolean, required: true },
  profilerType: { type: String, enum: ['java', 'simpleperf'], default: 'java' },
  samplesFile: { type: String, required: true }
}, {
  timestamps: true
});

// Indexes for efficient querying
ProfileSessionSchema.index({ createdAt: -1 });
ProfileSessionSchema.index({ deviceId: 1, createdAt: -1 });

export default mongoose.model<IProfileSession>('ProfileSession', ProfileSessionSchema);
