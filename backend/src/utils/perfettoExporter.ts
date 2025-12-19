import { IProfileSession, IProfileSample, IThreadSnapshot } from '../models/ProfileSession';

/**
 * Chrome Trace Event format.
 * See: https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU/preview
 */
export interface ChromeTraceEvent {
  name: string;          // Function name
  cat: string;           // Category
  ph: 'B' | 'E' | 'X' | 'I' | 'C' | 'M';  // Phase: Begin, End, Complete, Instant, Counter, Metadata
  ts: number;            // Timestamp in microseconds
  dur?: number;          // Duration in microseconds (for 'X' events)
  pid: number;           // Process ID
  tid: number;           // Thread ID
  args?: Record<string, unknown>;
}

export interface ChromeTraceFormat {
  traceEvents: ChromeTraceEvent[];
  displayTimeUnit: 'ms' | 'ns';
  metadata?: {
    'command_line'?: string;
    'device-model'?: string;
    'os-name'?: string;
    [key: string]: unknown;
  };
}

/**
 * Represents an active stack frame span being built.
 */
interface ActiveSpan {
  frameName: string;
  fullFrame: string;
  startTs: number;
  lastSeenTs: number;
  depth: number;
  state: string;
}

/**
 * Converts a profile session to Chrome Trace format that can be imported into Perfetto.
 *
 * Strategy for sampling data:
 * - Merge consecutive samples where a function appears into single events
 * - This gives more meaningful duration data than showing each sample as 50ms
 * - A gap of more than 2x the sampling interval closes the span
 */
export function exportToPerfettoJson(session: IProfileSession): string {
  const traceEvents: ChromeTraceEvent[] = [];
  const pid = 1; // Use a fixed PID since we only have one process

  // Add process metadata
  traceEvents.push({
    name: 'process_name',
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    pid,
    tid: 0,
    args: { name: 'DANR Profiled App' }
  });

  // Add session metadata
  traceEvents.push({
    name: 'session_info',
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    pid,
    tid: 0,
    args: {
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      samplingIntervalMs: session.samplingIntervalMs,
      totalSamples: session.totalSamples,
      hasRoot: session.hasRoot,
      note: 'Durations are estimated from sampling data'
    }
  });

  // Track thread names for metadata
  const threadNames = new Map<number, string>();

  // Track active spans per thread for merging consecutive samples
  // Key: `${tid}:${depth}:${frameName}`
  const activeSpans = new Map<string, ActiveSpan>();

  const startTime = session.startTime.getTime();
  const samplingIntervalUs = session.samplingIntervalMs * 1000;
  const gapThresholdUs = samplingIntervalUs * 2.5; // Close span if gap > 2.5x interval

  // Sort samples by timestamp
  const sortedSamples = [...session.samples].sort((a, b) => a.timestamp - b.timestamp);

  for (const sample of sortedSamples) {
    const tsUs = (sample.timestamp - startTime) * 1000;

    for (const thread of sample.threads) {
      const tid = thread.threadId;

      // Track thread name
      if (!threadNames.has(tid)) {
        threadNames.set(tid, thread.threadName);
      }

      // Get current stack frames (reversed for bottom-up order)
      const frames = thread.stackFrames.length > 0
        ? [...thread.stackFrames].reverse()
        : [];

      // Track which spans are still active this sample
      const currentFrameKeys = new Set<string>();

      // Process each frame in the stack
      for (let depth = 0; depth < frames.length; depth++) {
        const frameName = cleanFrameName(frames[depth]);
        const spanKey = `${tid}:${depth}:${frameName}`;
        currentFrameKeys.add(spanKey);

        const existingSpan = activeSpans.get(spanKey);

        if (existingSpan && (tsUs - existingSpan.lastSeenTs) <= gapThresholdUs) {
          // Continue existing span
          existingSpan.lastSeenTs = tsUs;
          existingSpan.state = thread.state;
        } else {
          // Close existing span if there was one
          if (existingSpan) {
            closeSpan(traceEvents, existingSpan, pid, tid, samplingIntervalUs);
          }

          // Start new span
          activeSpans.set(spanKey, {
            frameName,
            fullFrame: frames[depth],
            startTs: tsUs,
            lastSeenTs: tsUs,
            depth,
            state: thread.state
          });
        }
      }

      // Close spans that are no longer in the stack for this thread
      for (const [key, span] of activeSpans.entries()) {
        if (key.startsWith(`${tid}:`) && !currentFrameKeys.has(key)) {
          closeSpan(traceEvents, span, pid, tid, samplingIntervalUs);
          activeSpans.delete(key);
        }
      }

      // Add CPU usage as counter if available
      if (thread.cpuTime?.cpuUsagePercent !== undefined) {
        traceEvents.push({
          name: `CPU % (${thread.threadName})`,
          cat: 'cpu',
          ph: 'C',
          ts: tsUs,
          pid,
          tid,
          args: {
            value: thread.cpuTime.cpuUsagePercent
          }
        });
      }
    }

    // Add system CPU as counter if available
    if (sample.systemCPU) {
      traceEvents.push({
        name: 'System CPU',
        cat: 'system',
        ph: 'C',
        ts: (sample.timestamp - startTime) * 1000,
        pid,
        tid: 0,
        args: {
          user: sample.systemCPU.userPercent,
          system: sample.systemCPU.systemPercent,
          iowait: sample.systemCPU.iowaitPercent
        }
      });
    }
  }

  // Close any remaining active spans
  for (const [key, span] of activeSpans.entries()) {
    const tid = parseInt(key.split(':')[0]);
    closeSpan(traceEvents, span, pid, tid, samplingIntervalUs);
  }

  // Add thread name metadata
  for (const [tid, name] of threadNames) {
    traceEvents.push({
      name: 'thread_name',
      cat: '__metadata',
      ph: 'M',
      ts: 0,
      pid,
      tid,
      args: { name }
    });
  }

  // Sort events by timestamp
  traceEvents.sort((a, b) => a.ts - b.ts);

  const traceFormat: ChromeTraceFormat = {
    traceEvents,
    displayTimeUnit: 'ms',
    metadata: {
      'danr-session-id': session.sessionId,
      'danr-device-id': session.deviceId,
      'profile-start': session.startTime.toISOString(),
      'profile-end': session.endTime.toISOString(),
      'sampling-interval-ms': session.samplingIntervalMs,
      'total-samples': session.totalSamples,
      'has-root': session.hasRoot,
      'note': 'This is sampled data - durations are estimated based on consecutive sample appearances'
    }
  };

  return JSON.stringify(traceFormat, null, 2);
}

/**
 * Close a span and emit the trace event.
 */
function closeSpan(
  traceEvents: ChromeTraceEvent[],
  span: ActiveSpan,
  pid: number,
  tid: number,
  samplingIntervalUs: number
): void {
  // Duration is from start to last seen + one sampling interval
  const dur = (span.lastSeenTs - span.startTs) + samplingIntervalUs;

  traceEvents.push({
    name: span.frameName,
    cat: 'cpu',
    ph: 'X',
    ts: span.startTs,
    dur,
    pid,
    tid,
    args: {
      depth: span.depth,
      lastState: span.state,
      fullFrame: span.fullFrame,
      estimated: true
    }
  });
}

/**
 * Export to a minimal format optimized for file size.
 */
export function exportToPerfettoJsonMinified(session: IProfileSession): string {
  const result = exportToPerfettoJson(session);
  return JSON.stringify(JSON.parse(result)); // Remove whitespace
}

/**
 * Clean up a stack frame name for display.
 */
function cleanFrameName(frame: string): string {
  // Remove line number info in parentheses for cleaner display
  return frame.replace(/\([^)]*\)$/, '').trim();
}

/**
 * Create a simple timeline summary for quick visualization.
 */
export function createTimelineSummary(session: IProfileSession): {
  timestamps: number[];
  mainThreadCpu: (number | null)[];
  systemCpu: { user: number; system: number; iowait: number }[];
  threadStates: Map<string, string[]>;
} {
  const timestamps: number[] = [];
  const mainThreadCpu: (number | null)[] = [];
  const systemCpu: { user: number; system: number; iowait: number }[] = [];
  const threadStates = new Map<string, string[]>();

  for (const sample of session.samples) {
    timestamps.push(sample.timestamp);

    // Find main thread
    const mainThread = sample.threads.find(t => t.isMainThread);
    mainThreadCpu.push(mainThread?.cpuTime?.cpuUsagePercent ?? null);

    // System CPU
    systemCpu.push({
      user: sample.systemCPU?.userPercent ?? 0,
      system: sample.systemCPU?.systemPercent ?? 0,
      iowait: sample.systemCPU?.iowaitPercent ?? 0
    });

    // Thread states
    for (const thread of sample.threads) {
      if (!threadStates.has(thread.threadName)) {
        threadStates.set(thread.threadName, []);
      }
      threadStates.get(thread.threadName)!.push(thread.state);
    }
  }

  return { timestamps, mainThreadCpu, systemCpu, threadStates };
}
