'use client'

import { useQuery } from '@tanstack/react-query'
import { anrApi, type ANR, type ThreadInfo } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Trash2, Cpu, Smartphone, Package } from 'lucide-react'
import { Highlight, themes } from 'prism-react-renderer'
import { useState } from 'react'

export default function ANRDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [expandedThreads, setExpandedThreads] = useState<Record<number, boolean>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['anr', params.id],
    queryFn: () => anrApi.getById(params.id),
  })

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this ANR?')) {
      await anrApi.delete(params.id)
      router.push('/')
    }
  }

  const toggleThread = (threadId: number) => {
    setExpandedThreads(prev => ({
      ...prev,
      [threadId]: !prev[threadId]
    }))
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 lg:px-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-slate-600">Loading...</div>
      </div>
    )
  }

  const anr: ANR = data?.data

  if (!anr) {
    return (
      <div className="container mx-auto px-4 py-8 lg:px-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-slate-600">ANR not found</div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 lg:px-8">
      {/* Breadcrumbs */}
      <div className="mb-6 flex items-center text-sm text-slate-600">
        <Link href="/" className="hover:text-slate-900 transition-colors">
          Dashboard
        </Link>
        <span className="mx-2">/</span>
        <span className="text-slate-900 font-medium">ANR Details</span>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">ANR Details</h1>
          <p className="text-sm text-slate-600">
            Detected on {format(new Date(anr.timestamp), 'PPpp')}
          </p>
        </div>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </Button>
      </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="bg-white">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Device Info</CardTitle>
              <Smartphone className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <div className="text-xs text-slate-500">Device</div>
                <div className="font-medium">{anr.deviceInfo.manufacturer} {anr.deviceInfo.model}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">OS Version</div>
                <div className="font-medium">Android {anr.deviceInfo.osVersion} (API {anr.deviceInfo.sdkVersion})</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">RAM</div>
                <div className="font-medium">
                  {(anr.deviceInfo.availableRam / 1024 / 1024 / 1024).toFixed(2)} GB / {(anr.deviceInfo.totalRam / 1024 / 1024 / 1024).toFixed(2)} GB
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">App Info</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <div className="text-xs text-slate-500">Package</div>
                <div className="font-medium text-sm">{anr.appInfo.packageName}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Version</div>
                <div className="font-medium">{anr.appInfo.versionName} ({anr.appInfo.versionCode})</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">State</div>
                <Badge variant={anr.appInfo.isInForeground ? "default" : "secondary"}>
                  {anr.appInfo.isInForeground ? "Foreground" : "Background"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ANR Info</CardTitle>
              <Cpu className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <div className="text-xs text-slate-500">Timestamp</div>
                <div className="font-medium text-sm">{format(new Date(anr.timestamp), 'PPpp')}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Duration</div>
                <div className="font-medium">{anr.duration} ms</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Occurrences</div>
                <Badge>{anr.occurrenceCount}x</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6 bg-white">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Main Thread Stack Trace</CardTitle>
              <Badge variant="destructive">Main Thread</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <StackTraceView stackTrace={anr.mainThread.stackTrace} />
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardHeader>
            <CardTitle>All Threads ({anr.allThreads.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {anr.allThreads.map((thread) => (
                <div key={thread.id} className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleThread(thread.id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant={thread.isMainThread ? "destructive" : "outline"}>
                        {thread.name}
                      </Badge>
                      <span className="text-sm text-slate-600">ID: {thread.id}</span>
                      <span className="text-sm text-slate-600">State: {thread.state}</span>
                    </div>
                    <span className="text-slate-400">
                      {expandedThreads[thread.id] ? '▼' : '▶'}
                    </span>
                  </button>
                  {expandedThreads[thread.id] && (
                    <div className="p-4 border-t bg-slate-50">
                      <StackTraceView stackTrace={thread.stackTrace} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
    </div>
  )
}

function StackTraceView({ stackTrace }: { stackTrace: string[] }) {
  const code = stackTrace.join('\n')

  return (
    <Highlight theme={themes.vsDark} code={code} language="java">
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre className={`${className} p-4 rounded-lg overflow-x-auto text-sm`} style={style}>
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              <span className="inline-block w-8 text-right mr-4 text-slate-500 select-none">
                {i + 1}
              </span>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  )
}
