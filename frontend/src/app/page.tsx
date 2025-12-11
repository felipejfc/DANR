'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { anrApi, type ANR } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import Link from 'next/link'
import { Trash2, RefreshCw, AlertCircle } from 'lucide-react'

const AUTO_REFRESH_INTERVAL = 5000 // 5 seconds

export default function HomePage() {
  const [filters, setFilters] = useState({
    deviceModel: '',
    osVersion: '',
    isMainThread: undefined as boolean | undefined,
    sort: 'timestamp:desc',
    limit: 50,
    skip: 0,
  })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['anrs', filters],
    queryFn: () => anrApi.getAll(filters),
    refetchInterval: AUTO_REFRESH_INTERVAL,
  })

  const handleDeleteAll = async () => {
    if (confirm('Are you sure you want to delete all ANRs?')) {
      await anrApi.deleteAll()
      refetch()
    }
  }

  const anrs: ANR[] = data?.data || []
  const total = data?.total || 0

  return (
    <div className="container mx-auto px-4 py-8 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Dashboard
        </h1>
        <p className="text-slate-600">Overview of all ANRs</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="bg-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total ANRs</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
            <p className="text-xs text-muted-foreground mt-1">Across all devices</p>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => refetch()} className="flex-1">
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDeleteAll}
                className="flex-1"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-green-900">Status</CardTitle>
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-900">
              {isLoading ? 'Refreshing...' : 'Live'}
            </div>
            <p className="text-xs mt-1 text-green-700">
              Auto-refreshing every 5s
            </p>
          </CardContent>
        </Card>
      </div>

        <Card className="bg-white">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              Recent ANRs
              {isLoading && (
                <RefreshCw className="h-4 w-4 animate-spin text-green-600" />
              )}
            </CardTitle>
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              Live
            </Badge>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-slate-500">Loading...</div>
            ) : anrs.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No ANRs found. They will appear here when detected.
              </div>
            ) : (
              <div className="space-y-4">
                {anrs.map((anr) => (
                  <Link key={anr._id} href={`/anr/${anr._id}`}>
                    <div className="border rounded-lg p-4 hover:bg-slate-50 transition-colors cursor-pointer">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant={anr.mainThread.isMainThread ? "destructive" : "secondary"}>
                              {anr.mainThread.isMainThread ? "Main Thread" : "Background"}
                            </Badge>
                            <span className="text-sm text-slate-600">
                              {format(new Date(anr.timestamp), 'PPpp')}
                            </span>
                            {anr.occurrenceCount > 1 && (
                              <Badge variant="outline">
                                {anr.occurrenceCount}x
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm font-mono bg-slate-100 p-2 rounded mb-2">
                            {anr.mainThread.stackTrace[0]?.substring(0, 100) || 'No stack trace'}
                          </div>
                          <div className="flex gap-4 text-xs text-slate-600">
                            <span>{anr.deviceInfo.manufacturer} {anr.deviceInfo.model}</span>
                            <span>Android {anr.deviceInfo.osVersion}</span>
                            <span>{anr.appInfo.versionName}</span>
                            <span>{anr.duration}ms</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
    </div>
  )
}
