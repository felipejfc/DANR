'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import {
  Flame,
  ArrowLeft,
  Clock,
  Activity,
  RefreshCw,
  ChevronDown,
  Cpu,
  BarChart3,
  ListTree,
} from 'lucide-react';
import { profileApi, FlameGraphData, ThreadSummary } from '@/lib/api';
import { formatDuration } from '@/lib/profileUtils';
import FlameGraph from '@/components/profiler/FlameGraph';
import ProfileTimeline from '@/components/profiler/ProfileTimeline';
import PerfettoExportButton from '@/components/profiler/PerfettoExportButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ProfileDetailPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;

  const [selectedThread, setSelectedThread] = useState<string>('main');
  const [showThreadSelector, setShowThreadSelector] = useState(false);
  const [activeTab, setActiveTab] = useState<'flamegraph' | 'timeline'>('flamegraph');

  // Fetch profile session
  const { data: sessionData, isLoading: sessionLoading } = useQuery({
    queryKey: ['profile', sessionId],
    queryFn: () => profileApi.getById(sessionId),
  });

  const session = sessionData?.data;
  const isSimpleperf = session?.profilerType === 'simpleperf';

  // Fetch samples for timeline - only for Java profiles
  const { data: sessionWithSamples, isLoading: samplesLoading } = useQuery({
    queryKey: ['profile', sessionId, 'with-samples'],
    queryFn: () => profileApi.getById(sessionId, true),
    enabled: activeTab === 'timeline' && !isSimpleperf,
  });

  // Fetch flame graph data - only for Java profiles
  const { data: flameGraphData, isLoading: flameGraphLoading } = useQuery({
    queryKey: ['profile', sessionId, 'flamegraph', selectedThread],
    queryFn: () => profileApi.getFlameGraph(sessionId, selectedThread === 'all' ? undefined : selectedThread),
    enabled: !!sessionId && !isSimpleperf,
  });

  // Fetch thread summary - only for Java profiles
  const { data: threadSummaryData } = useQuery({
    queryKey: ['profile', sessionId, 'thread-summary'],
    queryFn: () => profileApi.getThreadSummary(sessionId),
    enabled: !!sessionId && !isSimpleperf,
  });

  const samples = sessionWithSamples?.data?.samples || [];
  const flameGraph: FlameGraphData | undefined = flameGraphData?.data;
  const threadSummaries: ThreadSummary[] = threadSummaryData?.data || [];
  const threadNames = flameGraph?.threads.map(t => t.threadName) || [];

  if (sessionLoading) {
    return (
      <div className="container mx-auto px-4 py-8 lg:px-8">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-8 lg:px-8">
        <div className="text-center py-12">
          <h2 className="text-xl font-medium text-slate-900">Profile not found</h2>
          <Link href="/profiles" className="text-blue-600 hover:underline mt-2 inline-block">
            Back to profiles
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 lg:px-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/profiles">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 bg-gradient-to-br rounded-lg flex items-center justify-center shadow-sm ${
              isSimpleperf ? 'from-purple-500 to-purple-600' : 'from-orange-500 to-orange-600'
            }`}>
              {isSimpleperf ? <Cpu className="h-6 w-6 text-white" /> : <Flame className="h-6 w-6 text-white" />}
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {isSimpleperf ? 'Native Profile' : 'Java Profile'}
              </h1>
              <p className="text-slate-500 text-sm font-mono">{session.sessionId}</p>
            </div>
          </div>
        </div>
        <PerfettoExportButton sessionId={sessionId} profilerType={session.profilerType} />
      </div>

      {/* Session Info */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-white">
          <CardContent className="p-4">
            <div className="text-slate-500 text-sm mb-1 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Created
            </div>
            <div className="font-medium text-slate-900">
              {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardContent className="p-4">
            <div className="text-slate-500 text-sm mb-1 flex items-center gap-2">
              <Activity className="h-4 w-4" />
              {isSimpleperf ? 'Type' : 'Samples'}
            </div>
            <div className="font-medium text-slate-900">
              {isSimpleperf ? (
                <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-sm font-medium">
                  Native (simpleperf)
                </span>
              ) : (
                session.totalSamples
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardContent className="p-4">
            <div className="text-slate-500 text-sm mb-1 flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Duration
            </div>
            <div className="font-medium text-slate-900">
              {formatDuration(session.startTime, session.endTime)}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardContent className="p-4">
            <div className="text-slate-500 text-sm mb-1">Interval</div>
            <div className="font-medium text-slate-900">{session.samplingIntervalMs}ms</div>
            {session.hasRoot && (
              <div className="mt-1 px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs inline-block font-medium">
                Root Enhanced
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Visualization */}
      {isSimpleperf ? (
        <Card className="bg-white">
          <CardContent className="py-12">
            <div className="text-center max-w-lg mx-auto">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                <Cpu className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-3">Native CPU Profile</h2>
              <p className="text-slate-600 mb-6">
                This profile was captured using simpleperf. For the best visualization with
                flame graphs and call stacks, open this trace in Perfetto UI.
              </p>
              <p className="text-slate-400 text-sm">
                Download the trace file, then drag and drop it into Perfetto UI to visualize.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'flamegraph' | 'timeline')}>
          <TabsList className="mb-4">
            <TabsTrigger value="flamegraph" className="flex items-center gap-2">
              <Flame className="h-4 w-4" />
              Flame Graph
            </TabsTrigger>
            <TabsTrigger value="timeline" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Timeline
            </TabsTrigger>
          </TabsList>

          <TabsContent value="flamegraph" className="space-y-6">
            {/* Thread Selector */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <Button
                  variant="outline"
                  onClick={() => setShowThreadSelector(!showThreadSelector)}
                  className="flex items-center gap-2"
                >
                  <span>Thread: {selectedThread}</span>
                  <ChevronDown className="h-4 w-4" />
                </Button>

                {showThreadSelector && (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-10 max-h-64 overflow-y-auto">
                    <button
                      onClick={() => { setSelectedThread('all'); setShowThreadSelector(false); }}
                      className={`w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-700 ${selectedThread === 'all' ? 'bg-slate-100' : ''}`}
                    >
                      All Threads
                    </button>
                    {threadNames.map((name) => (
                      <button
                        key={name}
                        onClick={() => { setSelectedThread(name); setShowThreadSelector(false); }}
                        className={`w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-700 ${selectedThread === name ? 'bg-slate-100' : ''}`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {flameGraph && (
                <span className="text-slate-500 text-sm">
                  {flameGraph.threads.length} thread{flameGraph.threads.length !== 1 ? 's' : ''},{' '}
                  {flameGraph.totalSamples} total samples
                </span>
              )}
            </div>

            {/* Flame Graph */}
            <Card className="bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListTree className="h-5 w-5" />
                  Flame Graph
                </CardTitle>
              </CardHeader>
              <CardContent>
                {flameGraphLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <RefreshCw className="h-8 w-8 animate-spin text-slate-400" />
                  </div>
                ) : flameGraph && flameGraph.threads.length > 0 ? (
                  <div className="space-y-6">
                    {(selectedThread === 'all' ? flameGraph.threads : flameGraph.threads.filter(t => t.threadName === selectedThread)).map((thread) => (
                      <div key={thread.threadId}>
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-medium text-slate-900">{thread.threadName}</h3>
                          <span className="text-slate-500 text-sm">({thread.sampleCount} samples)</span>
                        </div>
                        <div className="overflow-x-auto">
                          <FlameGraph data={thread.root} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500">No flame graph data available</div>
                )}
              </CardContent>
            </Card>

            {/* Thread Summary */}
            {threadSummaries.length > 0 && session.hasRoot && (
              <Card className="bg-white">
                <CardHeader>
                  <CardTitle>Thread CPU Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-slate-500 text-sm border-b border-slate-200">
                          <th className="pb-2">Thread</th>
                          <th className="pb-2">Avg CPU %</th>
                          <th className="pb-2">Primary State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {threadSummaries.slice(0, 20).map((thread) => (
                          <tr key={thread.threadId} className="border-b border-slate-100">
                            <td className="py-2 font-mono text-sm text-slate-700">{thread.threadName}</td>
                            <td className="py-2">
                              {thread.avgCpuUsage !== null ? (
                                <div className="flex items-center gap-2">
                                  <div className="w-20 bg-slate-200 rounded-full h-2">
                                    <div
                                      className="bg-orange-500 h-2 rounded-full"
                                      style={{ width: `${Math.min(100, thread.avgCpuUsage)}%` }}
                                    />
                                  </div>
                                  <span className="text-sm text-slate-700">{thread.avgCpuUsage.toFixed(1)}%</span>
                                </div>
                              ) : (
                                <span className="text-slate-400">N/A</span>
                              )}
                            </td>
                            <td className="py-2">
                              {thread.states[0] && (
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  thread.states[0].state === 'RUNNABLE' ? 'bg-green-100 text-green-700' :
                                  thread.states[0].state === 'BLOCKED' ? 'bg-red-100 text-red-700' :
                                  thread.states[0].state === 'WAITING' || thread.states[0].state === 'TIMED_WAITING' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {thread.states[0].state}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="timeline">
            <Card className="bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Sample Timeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                {samplesLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <RefreshCw className="h-8 w-8 animate-spin text-slate-400" />
                    <span className="ml-3 text-slate-500">Loading samples...</span>
                  </div>
                ) : samples.length > 0 ? (
                  <ProfileTimeline
                    samples={samples}
                    startTime={new Date(session.startTime).getTime()}
                    endTime={new Date(session.endTime).getTime()}
                    samplingIntervalMs={session.samplingIntervalMs}
                  />
                ) : (
                  <div className="text-center py-12 text-slate-500">No samples available</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
