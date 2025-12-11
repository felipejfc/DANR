'use client'

import { useQuery } from '@tanstack/react-query'
import { anrApi, type ANRGroup } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import Link from 'next/link'
import { Layers } from 'lucide-react'
import { useState } from 'react'

export default function GroupsPage() {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['anr-groups'],
    queryFn: () => anrApi.getGroups(),
  })

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }))
  }

  const groups: ANRGroup[] = data?.data || []

  return (
    <div className="container mx-auto px-4 py-8 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">ANR Groups</h1>
        <p className="text-slate-600">Similar ANRs clustered together</p>
      </div>

        <Card className="bg-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Groups ({groups.length})</CardTitle>
            <Layers className="h-5 w-5 text-slate-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-slate-500">Loading...</div>
            ) : groups.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No groups found. ANRs will be automatically grouped by similarity.
              </div>
            ) : (
              <div className="space-y-4">
                {groups.map((group) => (
                  <div key={group._id} className="border rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleGroup(group._id)}
                      className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-3 mb-2">
                          <Badge variant="default">{group.count} ANRs</Badge>
                          <Badge variant="outline">{group.similarity}% similar</Badge>
                          <span className="text-sm text-slate-600">
                            Last seen: {format(new Date(group.lastSeen), 'PPp')}
                          </span>
                        </div>
                        <div className="text-sm font-mono text-slate-700">
                          {group.stackTracePattern}
                        </div>
                      </div>
                      <span className="text-slate-400 ml-4">
                        {expandedGroups[group._id] ? '▼' : '▶'}
                      </span>
                    </button>
                    {expandedGroups[group._id] && (
                      <div className="p-4 border-t bg-slate-50">
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-slate-700 mb-3">
                            ANRs in this group:
                          </div>
                          {group.anrIds.map((anrId) => {
                            const id = typeof anrId === 'string' ? anrId : (anrId as any)?._id || anrId;
                            return (
                              <Link key={String(id)} href={`/anr/${String(id)}`}>
                                <div className="p-3 bg-white rounded border hover:border-primary transition-colors cursor-pointer">
                                  <span className="text-sm text-primary hover:underline">
                                    View ANR Details →
                                  </span>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
    </div>
  )
}
