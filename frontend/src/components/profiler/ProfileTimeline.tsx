'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ThreadSnapshot {
  threadId: number;
  threadName: string;
  state: string;
  stackFrames: string[];
  isMainThread: boolean;
  cpuTime?: {
    cpuUsagePercent?: number;
  };
}

interface ProfileSample {
  timestamp: number;
  threads: ThreadSnapshot[];
  systemCPU?: {
    userPercent: number;
    systemPercent: number;
    iowaitPercent: number;
  };
}

interface ProfileTimelineProps {
  samples: ProfileSample[];
  startTime: number;
  endTime: number;
  samplingIntervalMs: number;
  onSampleSelect?: (index: number, sample: ProfileSample) => void;
}

interface SelectedRange {
  start: number;
  end: number;
}

const STATE_COLORS: Record<string, string> = {
  RUNNABLE: '#22c55e',
  BLOCKED: '#ef4444',
  WAITING: '#eab308',
  TIMED_WAITING: '#f97316',
  NEW: '#8b5cf6',
  TERMINATED: '#6b7280',
};

const SELECTION_COLOR = '#3b82f6';

const FRAME_COLORS = [
  '#ff6b6b', '#ff8787', '#ffa8a8',
  '#ff922b', '#ffa94d', '#ffc078',
  '#fcc419', '#ffd43b', '#ffe066',
  '#94d82d', '#a9e34b', '#c0eb75',
  '#69db7c', '#8ce99a', '#b2f2bb',
  '#38d9a9', '#63e6be', '#96f2d7',
];

function getFrameColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash = hash & hash;
  }
  return FRAME_COLORS[Math.abs(hash) % FRAME_COLORS.length];
}

interface SeamlessFlameChartProps {
  samples: { sample: ProfileSample; index: number; thread: ThreadSnapshot | undefined }[];
  startTime: number;
  formatTime: (ms: number) => string;
}

interface MergedBlock {
  frame: string;
  startIdx: number;
  count: number;
  color: string;
}

function SeamlessFlameChart({ samples, startTime, formatTime }: SeamlessFlameChartProps) {
  const [tooltip, setTooltip] = useState<{ frame: string; count: number; x: number; y: number } | null>(null);

  // Find max stack depth across all samples
  const maxDepth = useMemo(() => {
    let max = 0;
    for (const { thread } of samples) {
      if (thread && thread.stackFrames.length > max) {
        max = thread.stackFrames.length;
      }
    }
    return max;
  }, [samples]);

  // Build merged blocks for each depth level - consecutive identical frames become one wider block
  const mergedRows = useMemo(() => {
    const rows: MergedBlock[][] = [];

    for (let depthIdx = 0; depthIdx < maxDepth; depthIdx++) {
      const row: MergedBlock[] = [];
      let currentBlock: MergedBlock | null = null;

      for (let sampleIdx = 0; sampleIdx < samples.length; sampleIdx++) {
        const { thread } = samples[sampleIdx];
        const frames = thread ? [...thread.stackFrames].reverse() : [];
        const frame = frames[depthIdx] || null;

        if (frame === null) {
          // Empty cell - close current block if any
          if (currentBlock) {
            row.push(currentBlock);
            currentBlock = null;
          }
          // Add empty block
          row.push({ frame: '', startIdx: sampleIdx, count: 1, color: '#f8fafc' });
        } else if (currentBlock && currentBlock.frame === frame) {
          // Same frame - extend current block
          currentBlock.count++;
        } else {
          // Different frame - close current block and start new one
          if (currentBlock) {
            row.push(currentBlock);
          }
          currentBlock = {
            frame,
            startIdx: sampleIdx,
            count: 1,
            color: getFrameColor(frame),
          };
        }
      }

      // Don't forget the last block
      if (currentBlock) {
        row.push(currentBlock);
      }

      rows.push(row);
    }

    return rows;
  }, [samples, maxDepth]);

  const CELL_HEIGHT = 20;
  const totalWidth = samples.length;

  const handleMouseMove = useCallback((e: React.MouseEvent, frame: string, count: number) => {
    if (frame) {
      setTooltip({ frame, count, x: e.clientX, y: e.clientY });
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  if (samples.length === 0 || maxDepth === 0) {
    return <div className="text-center text-sm text-slate-500 py-4">No stack data available</div>;
  }

  const timeStart = formatTime(samples[0].sample.timestamp - startTime);
  const timeEnd = formatTime(samples[samples.length - 1].sample.timestamp - startTime);

  return (
    <div className="relative">
      {/* Time labels */}
      <div className="flex justify-between text-[10px] text-slate-500 mb-1 px-1">
        <span>{timeStart}</span>
        <span>{samples.length} samples</span>
        <span>{timeEnd}</span>
      </div>

      {/* Flame chart - merged blocks */}
      <div className="border border-slate-200 rounded overflow-hidden">
        {mergedRows.map((row, depthIdx) => (
          <div key={depthIdx} className="flex" style={{ height: CELL_HEIGHT }}>
            {row.map((block, blockIdx) => {
              const widthPercent = (block.count / totalWidth) * 100;

              if (!block.frame) {
                // Empty block
                return (
                  <div
                    key={blockIdx}
                    style={{
                      width: `${widthPercent}%`,
                      height: CELL_HEIGHT,
                      backgroundColor: block.color,
                      borderRight: '1px solid #e2e8f0',
                    }}
                  />
                );
              }

              // Show full method signature, let CSS truncate with ellipsis
              // Frame format: "com.example.MyClass.myMethod(MyClass.java:123)"
              // Display: "com.example.MyClass.myMethod" (without file info)
              const displayName = block.frame.split('(')[0];

              return (
                <div
                  key={blockIdx}
                  className="flame-block overflow-hidden cursor-default"
                  style={{
                    width: `${widthPercent}%`,
                    height: CELL_HEIGHT,
                    backgroundColor: block.color,
                    borderRight: '1px solid rgba(0,0,0,0.1)',
                  }}
                  onMouseMove={(e) => handleMouseMove(e, block.frame, block.count)}
                  onMouseLeave={handleMouseLeave}
                >
                  <div
                    className="px-1 text-[9px] font-mono leading-[20px] text-black overflow-hidden whitespace-nowrap"
                    style={{ textOverflow: 'ellipsis' }}
                  >
                    {displayName}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white px-3 py-2 rounded shadow-lg text-xs max-w-md pointer-events-none"
          style={{ left: tooltip.x + 10, top: tooltip.y + 10 }}
        >
          <div className="font-mono break-all">{tooltip.frame}</div>
          <div className="text-gray-400 mt-1">{tooltip.count} sample{tooltip.count !== 1 ? 's' : ''} ({((tooltip.count / samples.length) * 100).toFixed(1)}%)</div>
        </div>
      )}

      {/* CSS for hover effect without state changes */}
      <style jsx>{`
        .flame-block:hover {
          filter: brightness(0.7);
        }
      `}</style>
    </div>
  );
}

function StackFlamegraph({ frames }: { frames: string[] }) {
  const reversedFrames = [...frames].reverse();

  if (reversedFrames.length === 0) {
    return <div className="text-slate-400 text-sm">No stack frames</div>;
  }

  return (
    <div className="space-y-0.5">
      {reversedFrames.map((frame, index) => {
        const color = getFrameColor(frame);

        return (
          <div
            key={index}
            className="relative"
            style={{ marginLeft: `${index * 8}px` }}
          >
            <div
              className="stack-frame px-2 py-1 rounded text-xs font-mono truncate cursor-default"
              style={{ backgroundColor: color }}
              title={frame}
            >
              {frame}
            </div>
          </div>
        );
      })}
      <style jsx>{`
        .stack-frame:hover {
          background-color: #374151 !important;
          color: #fff;
        }
      `}</style>
    </div>
  );
}

function ThreadStack({ thread }: { thread: ThreadSnapshot }) {
  const [expanded, setExpanded] = useState(thread.isMainThread);

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronUp className="h-4 w-4 text-slate-400" />}
          <span className="font-medium text-sm text-slate-900">
            {thread.isMainThread && '★ '}{thread.threadName}
          </span>
          <span className="text-xs text-slate-500">({thread.stackFrames.length} frames)</span>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded font-medium"
          style={{
            backgroundColor: STATE_COLORS[thread.state] + '20',
            color: STATE_COLORS[thread.state],
          }}
        >
          {thread.state}
        </span>
      </div>
      {expanded && (
        <div className="p-3 pt-0 border-t border-slate-100">
          <StackFlamegraph frames={thread.stackFrames} />
        </div>
      )}
    </div>
  );
}

export default function ProfileTimeline({
  samples,
  startTime,
  endTime,
  samplingIntervalMs,
  onSampleSelect,
}: ProfileTimelineProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedRange, setSelectedRange] = useState<SelectedRange | null>(null);
  const [currentDrag, setCurrentDrag] = useState<{ start: number; end: number } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);

  const isDraggingRef = useRef(false);
  const dragStartIndexRef = useRef<number | null>(null);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const duration = endTime - startTime;

  const mainThreadName = useMemo(() => {
    for (const sample of samples) {
      const mainThread = sample.threads.find(t => t.isMainThread);
      if (mainThread) return mainThread.threadName;
    }
    return 'main';
  }, [samples]);

  const threadNames = useMemo(() => {
    const names = new Set<string>();
    for (const sample of samples) {
      for (const thread of sample.threads) {
        names.add(thread.threadName);
      }
    }
    return Array.from(names).sort((a, b) => {
      if (a === mainThreadName) return -1;
      if (b === mainThreadName) return 1;
      return a.localeCompare(b);
    });
  }, [samples, mainThreadName]);

  // Default to main thread for comparison
  useEffect(() => {
    if (!selectedThread && threadNames.length > 0) {
      setSelectedThread(mainThreadName);
    }
  }, [threadNames, mainThreadName, selectedThread]);

  const displayedThreads = threadNames.slice(0, 8);

  // Get samples within the selected range
  const rangeSamples = useMemo(() => {
    if (!selectedRange || !selectedThread) return [];

    const start = Math.min(selectedRange.start, selectedRange.end);
    const end = Math.max(selectedRange.start, selectedRange.end);

    return samples.slice(start, end + 1).map((sample, i) => ({
      sample,
      index: start + i,
      thread: sample.threads.find(t => t.threadName === selectedThread),
    })).filter(s => s.thread);
  }, [selectedRange, selectedThread, samples]);

  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartIndexRef.current = index;
    setCurrentDrag({ start: index, end: index });
    setSelectedIndex(null);
  }, []);

  const handleMouseEnter = useCallback((index: number) => {
    if (isDraggingRef.current) {
      setCurrentDrag(prev => prev ? { ...prev, end: index } : null);
    }
  }, []);

  const handleMouseUp = useCallback((index: number) => {
    if (!isDraggingRef.current) return;

    isDraggingRef.current = false;
    const startIdx = dragStartIndexRef.current;

    if (startIdx === index) {
      // Single click - select sample
      setSelectedIndex(index);
      setSelectedRange(null);
      setCurrentDrag(null);
      onSampleSelect?.(index, samples[index]);
    } else if (startIdx !== null) {
      // Drag - set range selection
      setSelectedRange({
        start: Math.min(startIdx, index),
        end: Math.max(startIdx, index),
      });
      setSelectedIndex(null);
      setCurrentDrag(null);
    }
    dragStartIndexRef.current = null;
  }, [samples, onSampleSelect]);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        dragStartIndexRef.current = null;
        setCurrentDrag(null);
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const clearSelection = () => {
    setSelectedRange(null);
  };

  const handlePrevious = () => {
    if (selectedIndex !== null && selectedIndex > 0) {
      const newIndex = selectedIndex - 1;
      setSelectedIndex(newIndex);
      onSampleSelect?.(newIndex, samples[newIndex]);
    }
  };

  const handleNext = () => {
    if (selectedIndex !== null && selectedIndex < samples.length - 1) {
      const newIndex = selectedIndex + 1;
      setSelectedIndex(newIndex);
      onSampleSelect?.(newIndex, samples[newIndex]);
    }
  };

  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setSelectedIndex(prev => {
          const next = (prev ?? -1) + 1;
          if (next >= samples.length) {
            setIsPlaying(false);
            return prev;
          }
          onSampleSelect?.(next, samples[next]);
          return next;
        });
      }, 100);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, samples, onSampleSelect]);

  const formatTime = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

  const selectedSample = selectedIndex !== null ? samples[selectedIndex] : null;

  // Check if sample is in selection or current drag
  const isInSelection = (index: number) => {
    // Check current drag
    if (currentDrag) {
      const min = Math.min(currentDrag.start, currentDrag.end);
      const max = Math.max(currentDrag.start, currentDrag.end);
      if (index >= min && index <= max) return true;
    }
    // Check saved selection
    if (selectedRange) {
      if (index >= selectedRange.start && index <= selectedRange.end) return true;
    }
    return false;
  };

  return (
    <div className="space-y-4">
      {/* Timeline header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          {samples.length} samples over {formatTime(duration)}
          {selectedRange && (
            <span className="ml-2 text-blue-600 font-medium">
              • {selectedRange.end - selectedRange.start + 1} samples selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedRange && (
            <Button variant="outline" size="sm" onClick={clearSelection} className="text-xs">
              <X className="h-3 w-3 mr-1" />
              Clear Selection
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handlePrevious} disabled={selectedIndex === null || selectedIndex === 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={handleNext} disabled={selectedIndex === null || selectedIndex === samples.length - 1}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Instructions */}
      <div className="text-xs text-slate-400">
        Click to view sample • Drag to select time range and see individual samples side by side
      </div>

      {/* Timeline visualization */}
      <div className="relative bg-slate-100 rounded-lg p-4 overflow-x-auto select-none">
        <div className="flex justify-between text-xs text-slate-500 mb-2 px-1">
          <span>0s</span>
          <span>{formatTime(duration / 4)}</span>
          <span>{formatTime(duration / 2)}</span>
          <span>{formatTime((duration * 3) / 4)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <div className="space-y-1">
          {displayedThreads.map(threadName => (
            <div key={threadName} className="flex items-center gap-2">
              <div className="w-24 text-xs text-slate-600 truncate" title={threadName}>
                {threadName === mainThreadName ? '★ ' : ''}{threadName}
              </div>
              <div className="flex-1 h-6 bg-slate-200 rounded relative">
                {samples.map((sample, index) => {
                  const thread = sample.threads.find(t => t.threadName === threadName);
                  if (!thread) return null;

                  const position = ((sample.timestamp - startTime) / duration) * 100;
                  const width = Math.max(0.5, (samplingIntervalMs / duration) * 100);
                  const stateColor = STATE_COLORS[thread.state] || '#6b7280';
                  const isSelected = index === selectedIndex;
                  const inSelection = isInSelection(index);

                  return (
                    <div
                      key={index}
                      className="absolute top-0 h-full cursor-pointer timeline-sample"
                      style={{
                        left: `${position}%`,
                        width: `${width}%`,
                        minWidth: '4px',
                        backgroundColor: inSelection ? SELECTION_COLOR : stateColor,
                        opacity: isSelected || inSelection ? 1 : 0.6,
                        boxShadow: isSelected ? 'inset 0 0 0 2px #1e40af' : 'none',
                        zIndex: isSelected ? 10 : inSelection ? 5 : 1,
                      }}
                      onMouseDown={(e) => handleMouseDown(index, e)}
                      onMouseEnter={() => handleMouseEnter(index)}
                      onMouseUp={() => handleMouseUp(index)}
                      title={`${thread.state} - ${thread.stackFrames.length} frames`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-3 text-xs">
          {Object.entries(STATE_COLORS).map(([state, color]) => (
            <div key={state} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
              <span className="text-slate-600">{state}</span>
            </div>
          ))}
        </div>

        {/* Selection info */}
        {selectedRange && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200">
            <div
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white"
              style={{ backgroundColor: SELECTION_COLOR }}
            >
              <span>
                {formatTime(samples[selectedRange.start].timestamp - startTime)} - {formatTime(samples[selectedRange.end].timestamp - startTime)}
                ({selectedRange.end - selectedRange.start + 1} samples)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Seamless Flame Chart View */}
      {selectedRange && (
        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-slate-900">
              Flame Chart ({rangeSamples.length} samples)
            </h4>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Thread:</span>
              <select
                className="text-xs border border-slate-300 rounded px-2 py-1"
                value={selectedThread || ''}
                onChange={(e) => setSelectedThread(e.target.value)}
              >
                {threadNames.map(name => (
                  <option key={name} value={name}>{name === mainThreadName ? '★ ' : ''}{name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto bg-white rounded border border-slate-200 p-2">
            <SeamlessFlameChart
              samples={rangeSamples}
              startTime={startTime}
              formatTime={formatTime}
            />
          </div>
        </div>
      )}

      {/* Single sample details */}
      {!selectedRange && selectedSample && (
        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-slate-900">
              Sample at {formatTime(selectedSample.timestamp - startTime)}
            </h4>
            {selectedSample.systemCPU && (
              <div className="text-sm text-slate-500">
                System: {selectedSample.systemCPU.userPercent.toFixed(1)}% user,{' '}
                {selectedSample.systemCPU.systemPercent.toFixed(1)}% system
              </div>
            )}
          </div>
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {selectedSample.threads
              .filter(t => t.stackFrames.length > 0)
              .sort((a, b) => {
                if (a.isMainThread) return -1;
                if (b.isMainThread) return 1;
                return b.stackFrames.length - a.stackFrames.length;
              })
              .map(thread => (
                <ThreadStack key={thread.threadId} thread={thread} />
              ))}
          </div>
        </div>
      )}

      {!selectedRange && !selectedSample && (
        <div className="text-center text-sm text-slate-500 py-4">
          Click on a sample to view details, or drag to select a time range
        </div>
      )}

      {/* Global CSS for hover effects */}
      <style jsx>{`
        .timeline-sample:hover {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}
