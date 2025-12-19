import express, { Router, Request, Response } from 'express';
import zlib from 'zlib';
import ProfileSession, { saveSamplesToDisk, loadSamplesFromDisk, deleteSamplesFromDisk, saveTraceDataToDisk, getTraceFilePathIfExists } from '../models/ProfileSession';
import { aggregateToFlameGraph, getTopFunctions, getThreadSummary } from '../utils/flameGraphAggregator';
import { exportToPerfettoJson, exportToPerfettoJsonMinified } from '../utils/perfettoExporter';

const router = Router();

/**
 * GET /api/profiles - List all profile sessions
 */
router.get('/profiles', async (req: Request, res: Response) => {
  try {
    const {
      deviceId,
      limit = '20',
      skip = '0',
      sort = '-createdAt'
    } = req.query;

    const query: Record<string, unknown> = {};
    if (deviceId) {
      query.deviceId = deviceId;
    }

    const sessions = await ProfileSession.find(query)
      .select('-samples') // Exclude samples array for list view (too large)
      .sort(sort as string)
      .limit(parseInt(limit as string))
      .skip(parseInt(skip as string));

    const total = await ProfileSession.countDocuments(query);

    res.json({
      success: true,
      data: sessions,
      total,
      page: Math.floor(parseInt(skip as string) / parseInt(limit as string)) + 1,
      pageSize: parseInt(limit as string)
    });
  } catch (error) {
    console.error('Error fetching profile sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile sessions'
    });
  }
});

/**
 * GET /api/profiles/:sessionId - Get a specific profile session
 */
router.get('/profiles/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { includeSamples = 'false' } = req.query;

    const session = await ProfileSession.findOne({ sessionId });

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Profile session not found'
      });
      return;
    }

    const result: any = session.toObject();
    if (includeSamples === 'true') {
      result.samples = loadSamplesFromDisk(sessionId);
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error fetching profile session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile session'
    });
  }
});

/**
 * GET /api/profiles/:sessionId/flamegraph - Get flame graph data
 */
router.get('/profiles/:sessionId/flamegraph', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { thread } = req.query;

    const session = await ProfileSession.findOne({ sessionId });

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Profile session not found'
      });
      return;
    }

    const samples = loadSamplesFromDisk(session.sessionId);
    const flameGraphData = aggregateToFlameGraph(
      sessionId,
      samples,
      thread as string | undefined
    );

    res.json({
      success: true,
      data: flameGraphData
    });
  } catch (error) {
    console.error('Error generating flame graph:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate flame graph'
    });
  }
});

/**
 * GET /api/profiles/:sessionId/top-functions - Get top functions by sample count
 */
router.get('/profiles/:sessionId/top-functions', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { limit = '20' } = req.query;

    const session = await ProfileSession.findOne({ sessionId });

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Profile session not found'
      });
      return;
    }

    const samples = loadSamplesFromDisk(session.sessionId);
    const topFunctions = getTopFunctions(samples, parseInt(limit as string));

    res.json({
      success: true,
      data: topFunctions
    });
  } catch (error) {
    console.error('Error getting top functions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get top functions'
    });
  }
});

/**
 * GET /api/profiles/:sessionId/native-functions - Get native functions for simpleperf sessions
 * Returns parsed function names with percentages from simpleperf data
 */
router.get('/profiles/:sessionId/native-functions', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { limit = '100' } = req.query;

    const session = await ProfileSession.findOne({ sessionId });

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Profile session not found'
      });
      return;
    }

    const samples = loadSamplesFromDisk(session.sessionId);

    // Parse simpleperf format: each "thread" is actually a function with DSO as threadName
    // stackFrames[0] contains "functionName (percentage%)"
    const functions: { name: string; dso: string; percentage: number }[] = [];

    for (const sample of samples) {
      for (const thread of sample.threads) {
        if (thread.stackFrames.length > 0) {
          const frame = thread.stackFrames[0];
          // Parse "functionName (4.45%)" format
          const match = frame.match(/^(.+?)\s*\((\d+\.?\d*)%\)$/);
          if (match) {
            functions.push({
              name: match[1].trim(),
              dso: thread.threadName,
              percentage: parseFloat(match[2])
            });
          } else {
            // Fallback: use entire frame as name
            functions.push({
              name: frame,
              dso: thread.threadName,
              percentage: 0
            });
          }
        }
      }
    }

    // Sort by percentage descending and limit
    functions.sort((a, b) => b.percentage - a.percentage);
    const limitedFunctions = functions.slice(0, parseInt(limit as string));

    res.json({
      success: true,
      data: {
        sessionId,
        profilerType: session.profilerType || 'simpleperf',
        totalFunctions: functions.length,
        functions: limitedFunctions
      }
    });
  } catch (error) {
    console.error('Error getting native functions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get native functions'
    });
  }
});

/**
 * GET /api/profiles/:sessionId/thread-summary - Get thread summary with CPU info
 */
router.get('/profiles/:sessionId/thread-summary', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const session = await ProfileSession.findOne({ sessionId });

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Profile session not found'
      });
      return;
    }

    const samples = loadSamplesFromDisk(session.sessionId);
    const threadSummary = getThreadSummary(samples);

    res.json({
      success: true,
      data: threadSummary
    });
  } catch (error) {
    console.error('Error getting thread summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get thread summary'
    });
  }
});

/**
 * GET /api/profiles/:sessionId/perfetto - Download Perfetto-compatible JSON
 */
router.get('/profiles/:sessionId/perfetto', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { minified = 'false' } = req.query;

    const session = await ProfileSession.findOne({ sessionId });

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Profile session not found'
      });
      return;
    }

    // Create a session object with decompressed samples for the exporter
    const sessionWithSamples = {
      ...session.toObject(),
      samples: loadSamplesFromDisk(session.sessionId)
    };

    const json = minified === 'true'
      ? exportToPerfettoJsonMinified(sessionWithSamples as any)
      : exportToPerfettoJson(sessionWithSamples as any);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="profile-${sessionId}.json"`);
    res.send(json);
  } catch (error) {
    console.error('Error exporting to Perfetto:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export to Perfetto format'
    });
  }
});

/**
 * GET /api/profiles/:sessionId/trace - Download raw Perfetto trace file
 * For simpleperf sessions, returns the raw .perfetto-trace file
 */
router.get('/profiles/:sessionId/trace', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const session = await ProfileSession.findOne({ sessionId });

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Profile session not found'
      });
      return;
    }

    if (session.profilerType !== 'simpleperf') {
      res.status(400).json({
        success: false,
        error: 'Raw trace only available for simpleperf sessions'
      });
      return;
    }

    const traceFilePath = getTraceFilePathIfExists(sessionId);

    if (!traceFilePath) {
      res.status(404).json({
        success: false,
        error: 'Trace file not found'
      });
      return;
    }

    // Send the raw trace file for download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${sessionId}.perfetto-trace"`);
    res.sendFile(traceFilePath);
  } catch (error) {
    console.error('Error downloading trace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download trace file'
    });
  }
});

/**
 * DELETE /api/profiles/:sessionId - Delete a profile session
 */
router.delete('/profiles/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    // Delete samples file from disk
    deleteSamplesFromDisk(sessionId);

    const result = await ProfileSession.deleteOne({ sessionId });

    if (result.deletedCount === 0) {
      res.status(404).json({
        success: false,
        error: 'Profile session not found'
      });
      return;
    }

    res.json({
      success: true,
      message: 'Profile session deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting profile session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete profile session'
    });
  }
});

/**
 * DELETE /api/profiles - Delete all profile sessions
 */
router.delete('/profiles', async (req: Request, res: Response) => {
  void req;
  try {
    // Get all sessions to delete their files
    const sessions = await ProfileSession.find({}, { sessionId: 1 });
    for (const session of sessions) {
      deleteSamplesFromDisk(session.sessionId);
    }

    await ProfileSession.deleteMany({});

    res.json({
      success: true,
      message: 'All profile sessions deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting all profile sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete all profile sessions'
    });
  }
});

/**
 * POST /api/profile/upload - Upload profile data
 * Used by SDK to send profile data via HTTP
 */
router.post('/profile/upload', express.raw({ type: '*/*', limit: Infinity }), async (req: Request, res: Response) => {
  try {
    const deviceId = req.headers['x-device-id'] as string;
    const sessionId = req.headers['x-session-id'] as string;

    if (!deviceId || !sessionId) {
      res.status(400).json({
        success: false,
        error: 'Missing X-Device-Id or X-Session-Id header'
      });
      return;
    }

    const data = req.body as Buffer;

    // Auto-detect gzip (magic bytes 1f 8b)
    const isGzip = data[0] === 0x1f && data[1] === 0x8b;
    const jsonString = isGzip
      ? zlib.gunzipSync(data).toString('utf8')
      : data.toString('utf8');

    const session = JSON.parse(jsonString);

    // Detect profiler type from session data
    const profilerType = session.profilerType || 'java';
    let samplesFile: string;
    let totalSamples: number;

    if (profilerType === 'simpleperf') {
      if (session.traceData) {
        // For simpleperf: save raw Perfetto trace to disk
        samplesFile = saveTraceDataToDisk(session.sessionId, session.traceData);
        totalSamples = 0;  // Raw trace doesn't have sample count
        console.log(`[profile/upload] Saved simpleperf trace for session ${session.sessionId} (${session.traceData.length} base64 chars)`);
      } else {
        console.error(`[profile/upload] ERROR: simpleperf session ${session.sessionId} has no traceData!`);
        res.status(400).json({
          success: false,
          error: 'Simpleperf profiling failed: trace data was not captured. Check device logs for details.'
        });
        return;
      }
    } else {
      // For java profiling: save samples to disk
      const samples = session.samples || [];
      samplesFile = saveSamplesToDisk(session.sessionId, samples);
      totalSamples = session.totalSamples || samples.length;
    }

    // Save metadata to database
    const profileSession = new ProfileSession({
      deviceId,
      sessionId: session.sessionId,
      startTime: new Date(session.startTime),
      endTime: new Date(session.endTime),
      samplingIntervalMs: session.samplingIntervalMs,
      totalSamples,
      hasRoot: session.hasRoot,
      profilerType,
      samplesFile,
    });

    await profileSession.save();

    // Notify frontend via socket
    const { getSocketIO } = require('../sockets/deviceSocket');
    const io = getSocketIO();
    if (io) {
      io.emit('profile:session_complete', {
        deviceId,
        sessionId: session.sessionId,
        totalSamples: profileSession.totalSamples,
        profilerType,
        duration: profileSession.endTime.getTime() - profileSession.startTime.getTime(),
        timestamp: new Date(),
      });
    }

    res.json({
      success: true,
      sessionId: session.sessionId,
      totalSamples: profileSession.totalSamples,
      profilerType
    });
  } catch (error) {
    console.error('[profile/upload] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload profile'
    });
  }
});

export default router;
