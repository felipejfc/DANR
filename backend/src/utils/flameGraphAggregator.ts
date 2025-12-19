import { IProfileSample, IThreadSnapshot } from '../models/ProfileSession';

export interface FlameGraphNode {
  name: string;
  value: number;
  children: FlameGraphNode[];
}

export interface FlameGraphData {
  sessionId: string;
  totalSamples: number;
  threads: {
    threadName: string;
    threadId: number;
    sampleCount: number;
    root: FlameGraphNode;
  }[];
}

/**
 * Aggregates profile samples into flame graph format.
 *
 * The flame graph is built by:
 * 1. Grouping samples by thread
 * 2. For each thread, building a trie from stack traces
 * 3. Each node's value = count of samples where that function appears
 */
export function aggregateToFlameGraph(
  sessionId: string,
  samples: IProfileSample[],
  threadFilter?: string
): FlameGraphData {
  const threadMap = new Map<string, {
    threadName: string;
    threadId: number;
    stackTraces: string[][];
  }>();

  // Group stack traces by thread
  for (const sample of samples) {
    for (const thread of sample.threads) {
      // Apply thread filter if provided
      if (threadFilter && !thread.threadName.toLowerCase().includes(threadFilter.toLowerCase())) {
        continue;
      }

      const key = `${thread.threadId}:${thread.threadName}`;

      if (!threadMap.has(key)) {
        threadMap.set(key, {
          threadName: thread.threadName,
          threadId: thread.threadId,
          stackTraces: []
        });
      }

      // Only add non-empty stack traces
      if (thread.stackFrames.length > 0) {
        // Reverse the stack trace so root is first (bottom-up to top-down)
        threadMap.get(key)!.stackTraces.push([...thread.stackFrames].reverse());
      }
    }
  }

  // Build flame graph for each thread
  const threads = Array.from(threadMap.values()).map(threadData => {
    const root = buildFlameGraphTree(threadData.stackTraces);

    return {
      threadName: threadData.threadName,
      threadId: threadData.threadId,
      sampleCount: threadData.stackTraces.length,
      root
    };
  });

  // Sort threads by sample count (descending)
  threads.sort((a, b) => b.sampleCount - a.sampleCount);

  return {
    sessionId,
    totalSamples: samples.length,
    threads
  };
}

/**
 * Builds a flame graph tree from stack traces.
 *
 * Each stack trace is a path from root to leaf.
 * We count how many times each path is taken.
 */
function buildFlameGraphTree(stackTraces: string[][]): FlameGraphNode {
  const root: FlameGraphNode = {
    name: 'root',
    value: stackTraces.length,
    children: []
  };

  for (const trace of stackTraces) {
    let currentNode = root;

    for (const frame of trace) {
      // Clean up the frame name for better display
      const frameName = cleanFrameName(frame);

      // Find or create child node
      let childNode = currentNode.children.find(c => c.name === frameName);

      if (!childNode) {
        childNode = {
          name: frameName,
          value: 0,
          children: []
        };
        currentNode.children.push(childNode);
      }

      childNode.value++;
      currentNode = childNode;
    }
  }

  // Sort children by value (descending) at each level
  sortTreeByValue(root);

  return root;
}

/**
 * Recursively sorts children by value (descending).
 */
function sortTreeByValue(node: FlameGraphNode): void {
  node.children.sort((a, b) => b.value - a.value);
  for (const child of node.children) {
    sortTreeByValue(child);
  }
}

/**
 * Cleans up a stack frame name for display.
 *
 * Input: "com.example.MyClass.myMethod(MyClass.java:42)"
 * Output: "MyClass.myMethod" or keep full if short enough
 */
function cleanFrameName(frame: string): string {
  // Remove line number info in parentheses
  const withoutLineInfo = frame.replace(/\([^)]*\)$/, '').trim();

  // If it's already short, keep it
  if (withoutLineInfo.length <= 60) {
    return withoutLineInfo;
  }

  // Try to extract just class.method
  const parts = withoutLineInfo.split('.');
  if (parts.length >= 2) {
    // Keep last two parts (class and method)
    return parts.slice(-2).join('.');
  }

  return withoutLineInfo;
}

/**
 * Get top functions by sample count across all threads.
 */
export function getTopFunctions(
  samples: IProfileSample[],
  limit: number = 20
): { name: string; count: number; percentage: number }[] {
  const functionCounts = new Map<string, number>();
  let totalSamples = 0;

  for (const sample of samples) {
    for (const thread of sample.threads) {
      for (const frame of thread.stackFrames) {
        const frameName = cleanFrameName(frame);
        functionCounts.set(frameName, (functionCounts.get(frameName) || 0) + 1);
        totalSamples++;
      }
    }
  }

  const sorted = Array.from(functionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  return sorted.map(([name, count]) => ({
    name,
    count,
    percentage: totalSamples > 0 ? (count / totalSamples) * 100 : 0
  }));
}

/**
 * Get thread summary with CPU time info.
 */
export function getThreadSummary(
  samples: IProfileSample[]
): {
  threadName: string;
  threadId: number;
  avgCpuUsage: number | null;
  states: { state: string; count: number }[];
}[] {
  const threadMap = new Map<string, {
    threadName: string;
    threadId: number;
    cpuUsages: number[];
    states: Map<string, number>;
  }>();

  for (const sample of samples) {
    for (const thread of sample.threads) {
      const key = `${thread.threadId}:${thread.threadName}`;

      if (!threadMap.has(key)) {
        threadMap.set(key, {
          threadName: thread.threadName,
          threadId: thread.threadId,
          cpuUsages: [],
          states: new Map()
        });
      }

      const data = threadMap.get(key)!;

      // Track CPU usage if available
      if (thread.cpuTime?.cpuUsagePercent !== undefined) {
        data.cpuUsages.push(thread.cpuTime.cpuUsagePercent);
      }

      // Track states
      data.states.set(thread.state, (data.states.get(thread.state) || 0) + 1);
    }
  }

  return Array.from(threadMap.values()).map(data => ({
    threadName: data.threadName,
    threadId: data.threadId,
    avgCpuUsage: data.cpuUsages.length > 0
      ? data.cpuUsages.reduce((a, b) => a + b, 0) / data.cpuUsages.length
      : null,
    states: Array.from(data.states.entries())
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
  }));
}
