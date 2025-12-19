'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Square, Loader2, Activity, Info } from 'lucide-react';
import { socketService } from '@/lib/socket';
import { Button } from '@/components/ui/button';

interface ProfileStatus {
  state: 'idle' | 'running' | 'stopped' | 'converting';
  sessionId?: string;
  sampleCount: number;
  elapsedTimeMs: number;
  remainingTimeMs: number;
  samplingIntervalMs: number;
}

type ProcessingState = 'idle' | 'starting' | 'stopping' | 'processing';

interface ProfilerControlsProps {
  deviceId: string;
  hasRoot?: boolean;
  onSessionComplete?: (sessionId: string) => void;
}

export function ProfilerControls({ deviceId, hasRoot = false, onSessionComplete }: ProfilerControlsProps) {
  // Use ref to avoid re-subscribing socket listeners when callback changes
  const onSessionCompleteRef = useRef(onSessionComplete);
  onSessionCompleteRef.current = onSessionComplete;
  const [status, setStatus] = useState<ProfileStatus | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastSampleCount, setLastSampleCount] = useState<number>(0);

  // Configuration
  const [samplingInterval, setSamplingInterval] = useState(50);
  const [maxDuration, setMaxDuration] = useState(30);
  const [useSimpleperf, setUseSimpleperf] = useState(false);

  // Check if this is a standalone/daemon-only connection (no app with SDK)
  const isStandaloneMode = deviceId.startsWith('standalone');

  // Fetch initial status
  useEffect(() => {
    if (isStandaloneMode) return;

    const fetchStatus = async () => {
      try {
        const response = await socketService.getProfileStatus(deviceId);
        // Response structure: { success: true, status: { state, sessionId, sampleCount, ... } }
        if (response.success && response.status) {
          setStatus(response.status as ProfileStatus);
        }
      } catch {
        // Device might not have profiler initialized
      }
    };

    fetchStatus();
  }, [deviceId, isStandaloneMode]);

  // Listen for profile events
  useEffect(() => {
    if (isStandaloneMode) return;

    console.log('[ProfilerControls] Setting up socket listeners for device:', deviceId);

    const handleProfileStatus = (data: { deviceId: string; status: ProfileStatus }) => {
      console.log('[ProfilerControls] Received profile:status', data);
      if (data.deviceId === deviceId) {
        console.log('[ProfilerControls] Status update for our device:', data.status.state, 'samples:', data.status.sampleCount);
        setStatus(data.status);
      }
    };

    const handleSessionComplete = (data: { deviceId: string; sessionId: string }) => {
      console.log('[ProfilerControls] Received profile:session_complete', data);
      if (data.deviceId === deviceId) {
        console.log('[ProfilerControls] Session complete for our device! sessionId:', data.sessionId);
        // Clear any errors and reset state
        setError(null);
        setProcessingState('idle');
        setStatus({ state: 'idle', sampleCount: 0, elapsedTimeMs: 0, remainingTimeMs: 0, samplingIntervalMs: 0 });
        console.log('[ProfilerControls] Calling onSessionComplete callback...');
        onSessionCompleteRef.current?.(data.sessionId);
        console.log('[ProfilerControls] onSessionComplete callback finished');
      }
    };

    const handleProfileError = (data: { deviceId: string; error: string }) => {
      console.log('[ProfilerControls] Received profile:error', data);
      if (data.deviceId === deviceId) {
        setError(data.error);
        setProcessingState('idle');
        setStatus({ state: 'idle', sampleCount: 0, elapsedTimeMs: 0, remainingTimeMs: 0, samplingIntervalMs: 0 });
      }
    };

    socketService.on('profile:status', handleProfileStatus);
    socketService.on('profile:session_complete', handleSessionComplete);
    socketService.on('profile:error', handleProfileError);

    return () => {
      console.log('[ProfilerControls] Cleaning up socket listeners for device:', deviceId);
      socketService.off('profile:status', handleProfileStatus);
      socketService.off('profile:session_complete', handleSessionComplete);
      socketService.off('profile:error', handleProfileError);
    };
  }, [deviceId, isStandaloneMode]);

  const handleStart = useCallback(async () => {
    setProcessingState('starting');
    setError(null);

    try {
      const response = await socketService.startProfiling(deviceId, {
        samplingIntervalMs: samplingInterval,
        maxDurationMs: maxDuration * 1000,
        useSimpleperf,
      });

      if (!response.success) {
        setError(response.message || 'Failed to start profiling');
        setProcessingState('idle');
      } else {
        setProcessingState('idle');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start profiling');
      setProcessingState('idle');
    }
  }, [deviceId, samplingInterval, maxDuration, useSimpleperf]);

  const handleStop = useCallback(async () => {
    // Save sample count before stopping for UI feedback
    setLastSampleCount(status?.sampleCount || 0);
    setProcessingState('stopping');
    setError(null);

    try {
      const response = await socketService.stopProfiling(deviceId);

      if (!response.success) {
        // Only show error if it's not a timeout (timeout is expected for large sessions)
        if (response.message !== 'Command timeout') {
          setError(response.message || 'Failed to stop profiling');
          setProcessingState('idle');
        } else {
          // Timeout - switch to processing state, session will complete via socket event
          setProcessingState('processing');
        }
      } else {
        // Success - switch to processing state while waiting for session_complete
        setProcessingState('processing');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to stop profiling';
      // If it's a timeout, switch to processing state instead of showing error
      if (errorMessage === 'Command timeout') {
        setProcessingState('processing');
      } else {
        setError(errorMessage);
        setProcessingState('idle');
      }
    }
  }, [deviceId, status?.sampleCount]);

  const isRunning = status?.state === 'running';
  const isConverting = status?.state === 'converting';

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${remainingSeconds}s`;
  };

  // Show message when in standalone mode
  if (isStandaloneMode) {
    return (
      <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="font-medium text-amber-800">Profiling Not Available</h4>
            <p className="text-sm text-amber-700 mt-1">
              CPU profiling requires an app with the DANR SDK integrated.
              The standalone daemon connection only supports stress testing and CPU frequency control.
            </p>
            <p className="text-sm text-amber-600 mt-2">
              To use profiling, open an app that has the DANR SDK installed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Configuration */}
      {!isRunning && processingState === 'idle' && (
        <div className="space-y-4">
          {/* Simpleperf toggle - only show if device has root */}
          {hasRoot && (
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <input
                type="checkbox"
                id="useSimpleperf"
                checked={useSimpleperf}
                onChange={(e) => setUseSimpleperf(e.target.checked)}
                className="h-4 w-4 text-blue-600 rounded border-slate-300"
              />
              <div>
                <label htmlFor="useSimpleperf" className="text-sm font-medium text-slate-700 cursor-pointer">
                  Use simpleperf (Native Profiling)
                </label>
                <p className="text-xs text-slate-500">
                  More accurate native profiling including C/C++ code. Requires root. Uses 4000 Hz sampling.
                </p>
              </div>
            </div>
          )}

          <div className={`grid gap-4 ${useSimpleperf ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {/* Only show sampling interval for Java profiling */}
            {!useSimpleperf && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Sampling Interval
                </label>
                <select
                  value={samplingInterval}
                  onChange={(e) => setSamplingInterval(Number(e.target.value))}
                  className="w-full bg-white border border-slate-300 rounded px-3 py-2 text-slate-900"
                >
                  <option value={50}>50ms (20 Hz)</option>
                  <option value={100}>100ms (10 Hz)</option>
                  <option value={200}>200ms (5 Hz)</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Max Duration
              </label>
              <select
                value={maxDuration}
                onChange={(e) => setMaxDuration(Number(e.target.value))}
                className="w-full bg-white border border-slate-300 rounded px-3 py-2 text-slate-900"
              >
                <option value={10}>10 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Status display when running */}
      {isRunning && status && processingState !== 'stopping' && processingState !== 'processing' && (
        <div className={`rounded-lg p-4 space-y-3 border ${
          status.remainingTimeMs <= 0
            ? 'bg-amber-50 border-amber-200'
            : 'bg-slate-100 border-slate-200'
        }`}>
          <div className="flex items-center gap-2">
            {status.remainingTimeMs <= 0 ? (
              <>
                <Loader2 className="h-5 w-5 text-amber-600 animate-spin" />
                <span className="text-amber-700 font-medium">Finishing recording...</span>
              </>
            ) : (
              <>
                <Activity className="h-5 w-5 text-green-600 animate-pulse" />
                <span className="text-green-700 font-medium">Profiling in progress...</span>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Samples</div>
              <div className="text-xl font-mono text-slate-900">{status.sampleCount.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-slate-500">Elapsed</div>
              <div className="text-xl font-mono text-slate-900">{formatTime(status.elapsedTimeMs)}</div>
            </div>
            <div>
              <div className="text-slate-500">{status.remainingTimeMs <= 0 ? 'Status' : 'Remaining'}</div>
              <div className="text-xl font-mono text-slate-900">
                {status.remainingTimeMs <= 0 ? 'Finalizing' : formatTime(status.remainingTimeMs)}
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className={`w-full rounded-full h-2 ${status.remainingTimeMs <= 0 ? 'bg-amber-200' : 'bg-slate-300'}`}>
            <div
              className={`h-2 rounded-full ${
                status.remainingTimeMs <= 0
                  ? 'bg-amber-500 animate-pulse w-full'
                  : 'bg-green-500 transition-all duration-500'
              }`}
              style={status.remainingTimeMs > 0 ? {
                width: `${Math.min(100, (status.elapsedTimeMs / (status.elapsedTimeMs + status.remainingTimeMs)) * 100)}%`
              } : undefined}
            />
          </div>

          {status.remainingTimeMs <= 0 && (
            <p className="text-sm text-amber-600">
              Simpleperf is finalizing the recording data. This may take a few seconds...
            </p>
          )}
        </div>
      )}

      {/* Converting state - simpleperf finished recording, now converting trace */}
      {isConverting && status && processingState !== 'stopping' && processingState !== 'processing' && (
        <div className="bg-amber-50 rounded-lg p-4 space-y-3 border border-amber-200">
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 text-amber-600 animate-spin" />
            <span className="text-amber-700 font-medium">Converting trace to Perfetto format...</span>
          </div>
          <p className="text-sm text-amber-600">
            Recording complete with ~{status.sampleCount.toLocaleString()} samples. Converting may take up to a minute for large traces.
          </p>
          <div className="w-full bg-amber-200 rounded-full h-2 overflow-hidden">
            <div className="bg-amber-500 h-2 rounded-full animate-pulse w-full" />
          </div>
        </div>
      )}

      {/* Stopping/Processing state */}
      {(processingState === 'stopping' || processingState === 'processing') && (
        <div className="bg-blue-50 rounded-lg p-4 space-y-3 border border-blue-200">
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
            <span className="text-blue-700 font-medium">
              {processingState === 'stopping' ? 'Stopping profiler...' : 'Processing trace data...'}
            </span>
          </div>
          <p className="text-sm text-blue-600">
            {processingState === 'stopping'
              ? 'Sending stop command to device...'
              : `Processing ${lastSampleCount > 0 ? `${lastSampleCount} samples` : 'trace'}. This may take a moment for large sessions.`
            }
          </p>
          <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
            <div className="bg-blue-500 h-2 rounded-full animate-pulse w-full" />
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-3">
        {!isRunning && !isConverting && processingState === 'idle' ? (
          <Button
            onClick={handleStart}
            disabled={processingState === 'starting'}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700"
          >
            {processingState === 'starting' ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Play className="h-5 w-5" />
            )}
            Start Profiling
          </Button>
        ) : isRunning && processingState !== 'stopping' && processingState !== 'processing' ? (
          <Button
            onClick={handleStop}
            disabled={processingState === 'stopping'}
            variant="destructive"
            className="flex items-center gap-2"
          >
            {processingState === 'stopping' ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Square className="h-5 w-5" />
            )}
            Stop Profiling
          </Button>
        ) : isConverting && processingState !== 'stopping' && processingState !== 'processing' ? (
          <Button
            disabled
            variant="outline"
            className="flex items-center gap-2"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            Converting...
          </Button>
        ) : (processingState === 'stopping' || processingState === 'processing') ? (
          <Button
            disabled
            variant="outline"
            className="flex items-center gap-2"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            {processingState === 'stopping' ? 'Stopping...' : 'Processing...'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default ProfilerControls;
