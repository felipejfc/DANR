'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Flame, Trash2, Clock, Activity, RefreshCw, Download } from 'lucide-react';
import { profileApi, ProfileSession } from '@/lib/api';
import { formatDuration, downloadProfileTrace } from '@/lib/profileUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function ProfilesPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => profileApi.getAll({ limit: 50 }),
    refetchInterval: 10000,
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => profileApi.delete(sessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profiles'] }),
  });

  const deleteAllMutation = useMutation({
    mutationFn: () => profileApi.deleteAll(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profiles'] }),
  });

  const profiles: ProfileSession[] = data?.data || [];

  const handleExport = async (profile: ProfileSession, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await downloadProfileTrace(profile.sessionId, profile.profilerType);
    } catch (error) {
      console.error('Failed to export profile:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 lg:px-8">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8 lg:px-8">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          Failed to load profiles: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 lg:px-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center shadow-sm">
            <Flame className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">CPU Profiles</h1>
            <p className="text-slate-600">
              {profiles.length} profile session{profiles.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => refetch()} className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>

          {profiles.length > 0 && (
            <Button
              variant="destructive"
              onClick={() => confirm('Delete all profile sessions?') && deleteAllMutation.mutate()}
              disabled={deleteAllMutation.isPending}
              className="flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete All
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {profiles.length === 0 && (
        <Card className="bg-white">
          <CardContent className="text-center py-12">
            <Flame className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700">No profiles yet</h3>
            <p className="text-slate-500 mt-1">Start a profiling session from the Device Control page</p>
            <Link href="/devices" className="inline-block mt-4">
              <Button className="bg-orange-600 hover:bg-orange-700">Go to Device Control</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Profiles list */}
      {profiles.length > 0 && (
        <Card className="bg-white">
          <CardHeader>
            <CardTitle>Profile Sessions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {profiles.map((profile) => (
              <Link
                key={profile.sessionId}
                href={`/profiles/${profile.sessionId}`}
                className="block bg-slate-50 hover:bg-slate-100 rounded-lg p-4 transition-colors border border-slate-200"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="bg-orange-100 p-2 rounded-lg">
                      <Flame className="h-6 w-6 text-orange-600" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">
                        Session {profile.sessionId.slice(0, 8)}...
                      </div>
                      <div className="text-sm text-slate-500 flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(profile.createdAt), { addSuffix: true })}
                        </span>
                        <span className="flex items-center gap-1">
                          <Activity className="h-3 w-3" />
                          {profile.totalSamples} samples
                        </span>
                        <span>Duration: {formatDuration(profile.startTime, profile.endTime)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          profile.profilerType === 'simpleperf'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {profile.profilerType === 'simpleperf' ? 'Native' : 'Java'}
                        </span>
                        {profile.hasRoot && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
                            Root
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => handleExport(profile, e)}
                      title="Export for Perfetto"
                    >
                      <Download className="h-4 w-4 text-slate-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        confirm('Delete this profile session?') && deleteMutation.mutate(profile.sessionId);
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-slate-500 hover:text-red-500" />
                    </Button>
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
