import ANR, { IANR } from '../models/ANR';
import ANRGroup from '../models/ANRGroup';
import {
  generateStackTraceHash,
  calculateSimilarity,
  extractStackTracePattern,
  SIMILARITY_THRESHOLD
} from '../utils/anrProcessor';
import mongoose from 'mongoose';

export async function createOrUpdateANR(anrData: Partial<IANR>): Promise<IANR> {
  if (!anrData.mainThread) {
    throw new Error('Main thread data is required');
  }

  const stackTraceHash = generateStackTraceHash(anrData.mainThread.stackTrace);

  const existingANR = await ANR.findOne({ stackTraceHash });

  if (existingANR) {
    existingANR.occurrenceCount += 1;
    existingANR.lastOccurrence = new Date();
    await existingANR.save();
    return existingANR;
  }

  const newANR = new ANR({
    ...anrData,
    stackTraceHash,
    occurrenceCount: 1,
    firstOccurrence: new Date(),
    lastOccurrence: new Date()
  });

  await newANR.save();

  await assignToGroup(newANR);

  return newANR;
}

async function assignToGroup(anr: IANR): Promise<void> {
  const existingGroup = await ANRGroup.findOne({ stackTraceHash: anr.stackTraceHash });

  if (existingGroup) {
    existingGroup.count += 1;
    existingGroup.lastSeen = new Date();
    existingGroup.anrIds.push(anr._id as mongoose.Types.ObjectId);
    await existingGroup.save();

    anr.groupId = existingGroup._id as mongoose.Types.ObjectId;
    await anr.save();
    return;
  }

  const allGroups = await ANRGroup.find();

  for (const group of allGroups) {
    const groupANR = await ANR.findById(group.anrIds[0]);
    if (!groupANR) continue;

    const similarity = calculateSimilarity(
      anr.mainThread.stackTrace,
      groupANR.mainThread.stackTrace
    );

    if (similarity >= SIMILARITY_THRESHOLD) {
      group.count += 1;
      group.lastSeen = new Date();
      group.anrIds.push(anr._id as mongoose.Types.ObjectId);
      await group.save();

      anr.groupId = group._id as mongoose.Types.ObjectId;
      await anr.save();
      return;
    }
  }

  const pattern = extractStackTracePattern(anr.mainThread.stackTrace);
  const newGroup = new ANRGroup({
    stackTracePattern: pattern,
    stackTraceHash: anr.stackTraceHash,
    count: 1,
    firstSeen: new Date(),
    lastSeen: new Date(),
    anrIds: [anr._id],
    similarity: 100
  });

  await newGroup.save();

  anr.groupId = newGroup._id as mongoose.Types.ObjectId;
  await anr.save();
}

export async function getAllANRs(filters: {
  deviceModel?: string;
  osVersion?: string;
  startDate?: Date;
  endDate?: Date;
  isMainThread?: boolean;
  sort?: string;
  limit?: number;
  skip?: number;
}) {
  const query: any = {};

  if (filters.deviceModel) {
    query['deviceInfo.model'] = new RegExp(filters.deviceModel, 'i');
  }

  if (filters.osVersion) {
    query['deviceInfo.osVersion'] = filters.osVersion;
  }

  if (filters.startDate || filters.endDate) {
    query.timestamp = {};
    if (filters.startDate) query.timestamp.$gte = filters.startDate;
    if (filters.endDate) query.timestamp.$lte = filters.endDate;
  }

  if (filters.isMainThread !== undefined) {
    query['mainThread.isMainThread'] = filters.isMainThread;
  }

  const sortOption: any = {};
  if (filters.sort) {
    const [field, order] = filters.sort.split(':');
    sortOption[field] = order === 'asc' ? 1 : -1;
  } else {
    sortOption.timestamp = -1;
  }

  const anrs = await ANR.find(query)
    .sort(sortOption)
    .limit(filters.limit || 50)
    .skip(filters.skip || 0);

  const total = await ANR.countDocuments(query);

  return { anrs, total };
}

export async function getANRById(id: string): Promise<IANR | null> {
  return await ANR.findById(id);
}

export async function deleteANR(id: string): Promise<void> {
  const anr = await ANR.findById(id);
  if (!anr) {
    throw new Error('ANR not found');
  }

  if (anr.groupId) {
    const group = await ANRGroup.findById(anr.groupId);
    if (group) {
      group.anrIds = group.anrIds.filter((anrId) => anrId.toString() !== id);
      group.count = group.anrIds.length;

      if (group.count === 0) {
        await ANRGroup.findByIdAndDelete(group._id);
      } else {
        await group.save();
      }
    }
  }

  await ANR.findByIdAndDelete(id);
}

export async function deleteAllANRs(): Promise<void> {
  await ANR.deleteMany({});
  await ANRGroup.deleteMany({});
}

export async function getANRGroups() {
  const groups = await ANRGroup.find().sort({ count: -1 });
  return groups;
}

export async function getAnalytics() {
  const totalANRs = await ANR.countDocuments();

  const anrsByDevice = await ANR.aggregate([
    {
      $group: {
        _id: '$deviceInfo.model',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);

  const anrsByOS = await ANR.aggregate([
    {
      $group: {
        _id: '$deviceInfo.osVersion',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]);

  const anrsByThread = await ANR.aggregate([
    {
      $group: {
        _id: { $cond: ['$mainThread.isMainThread', 'Main Thread', 'Background Thread'] },
        count: { $sum: 1 }
      }
    }
  ]);

  const anrsOverTime = await ANR.aggregate([
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  const topCrashLocations = await ANR.aggregate([
    {
      $group: {
        _id: '$mainThread.stackTrace.0',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);

  return {
    totalANRs,
    anrsByDevice,
    anrsByOS,
    anrsByThread,
    anrsOverTime,
    topCrashLocations
  };
}
