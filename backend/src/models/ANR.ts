import mongoose, { Schema, Document } from 'mongoose';

export interface IThread {
  name: string;
  id: number;
  state: string;
  stackTrace: string[];
  isMainThread: boolean;
}

export interface IDeviceInfo {
  manufacturer: string;
  model: string;
  osVersion: string;
  sdkVersion: number;
  totalRam: number;
  availableRam: number;
}

export interface IAppInfo {
  packageName: string;
  versionName: string;
  versionCode: number;
  isInForeground: boolean;
}

export interface IANR extends Document {
  timestamp: Date;
  duration: number;
  mainThread: IThread;
  allThreads: IThread[];
  deviceInfo: IDeviceInfo;
  appInfo: IAppInfo;
  stackTraceHash: string;
  groupId?: mongoose.Types.ObjectId;
  occurrenceCount: number;
  firstOccurrence: Date;
  lastOccurrence: Date;
}

const ThreadSchema = new Schema<IThread>({
  name: { type: String, required: true },
  id: { type: Number, required: true },
  state: { type: String, required: true },
  stackTrace: { type: [String], required: true },
  isMainThread: { type: Boolean, required: true }
});

const DeviceInfoSchema = new Schema<IDeviceInfo>({
  manufacturer: { type: String, required: true },
  model: { type: String, required: true },
  osVersion: { type: String, required: true },
  sdkVersion: { type: Number, required: true },
  totalRam: { type: Number, required: true },
  availableRam: { type: Number, required: true }
});

const AppInfoSchema = new Schema<IAppInfo>({
  packageName: { type: String, required: true },
  versionName: { type: String, required: true },
  versionCode: { type: Number, required: true },
  isInForeground: { type: Boolean, required: true }
});

const ANRSchema = new Schema<IANR>({
  timestamp: { type: Date, required: true, default: Date.now },
  duration: { type: Number, required: true },
  mainThread: { type: ThreadSchema, required: true },
  allThreads: { type: [ThreadSchema], required: true },
  deviceInfo: { type: DeviceInfoSchema, required: true },
  appInfo: { type: AppInfoSchema, required: true },
  stackTraceHash: { type: String, required: true, index: true },
  groupId: { type: Schema.Types.ObjectId, ref: 'ANRGroup' },
  occurrenceCount: { type: Number, default: 1 },
  firstOccurrence: { type: Date, required: true, default: Date.now },
  lastOccurrence: { type: Date, required: true, default: Date.now }
}, {
  timestamps: true
});

// Indexes for efficient querying
ANRSchema.index({ timestamp: -1 });
ANRSchema.index({ 'deviceInfo.model': 1 });
ANRSchema.index({ 'deviceInfo.osVersion': 1 });
ANRSchema.index({ 'appInfo.versionCode': 1 });
ANRSchema.index({ groupId: 1 });

export default mongoose.model<IANR>('ANR', ANRSchema);
