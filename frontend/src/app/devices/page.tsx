'use client'

import { useState, useEffect } from 'react'
import { useDevices } from '@/hooks/useDevices'
import { socketService, Device } from '@/lib/socket'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Smartphone,
  Cpu,
  AlertTriangle,
  RefreshCw,
  Zap,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
  Gauge
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const ANR_TRIGGERS = [
  { id: 'infinite_loop', name: 'Infinite Loop', description: 'Blocks main thread with busy loop' },
  { id: 'sleep', name: 'Sleep', description: 'Main thread sleeps for duration' },
  { id: 'heavy_computation', name: 'Heavy Computation', description: 'CPU-intensive calculation' },
  { id: 'memory_stress', name: 'Memory Stress', description: 'Allocates large arrays' },
  { id: 'disk_io', name: 'Disk I/O', description: 'Synchronous file operations' },
  { id: 'network', name: 'Network Request', description: 'Synchronous network call' },
]

const CPU_PRESETS = [
  { name: 'Normal', percentage: 100 },
  { name: 'High (75%)', percentage: 75 },
  { name: 'Medium (50%)', percentage: 50 },
  { name: 'Low (25%)', percentage: 25 },
]

const STRESS_TESTS = [
  {
    id: 'cpu',
    name: 'CPU Stress',
    description: 'Background CPU load on multiple threads',
    icon: Cpu,
    options: {
      threadCounts: [1, 2, 4, 6, 8],
      loadPercentages: [25, 50, 75, 100],
    },
  },
  {
    id: 'memory',
    name: 'Memory Pressure',
    description: 'Allocates memory until target free memory is reached',
    icon: Activity,
    options: {
      targetFreeMemories: [50, 100, 200, 300],
    },
  },
  {
    id: 'disk_io',
    name: 'Disk I/O',
    description: 'Continuous read/write operations',
    icon: Gauge,
    options: {
      throughputs: [1, 5, 10, 20],
    },
  },
]

interface DeviceCardProps {
  device: Device
}

function DeviceCard({ device }: DeviceCardProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [selectedFreq, setSelectedFreq] = useState<number | null>(null)
  const [stressStatuses, setStressStatuses] = useState<Record<string, { isRunning: boolean; remainingTimeMs: number }>>({})
  const [stressConfigs, setStressConfigs] = useState<Record<string, any>>({
    cpu: { threadCount: 4, loadPercentage: 100 },
    memory: { targetMemoryMB: 100 },
    disk_io: { throughputMBps: 5 },
  })

  // Fetch stress status on mount
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await socketService.getStressStatus(device.id)
        if (response.success && response.data && Array.isArray(response.data)) {
          const statusMap: Record<string, { isRunning: boolean; remainingTimeMs: number }> = {}
          response.data.forEach((status: any) => {
            statusMap[status.type] = {
              isRunning: status.isRunning,
              remainingTimeMs: status.remainingTimeMs || 0
            }
          })
          setStressStatuses(statusMap)
        }
      } catch (error) {
        console.error('Failed to fetch stress status:', error)
      }
    }
    fetchStatus()
  }, [device.id])

  // Listen for real-time stress status updates
  useEffect(() => {
    const handleStressStatus = (data: { deviceId: string; stressStatuses: any[] }) => {
      if (data.deviceId === device.id) {
        const statusMap: Record<string, { isRunning: boolean; remainingTimeMs: number }> = {}
        data.stressStatuses.forEach((status: any) => {
          statusMap[status.type] = {
            isRunning: status.isRunning,
            remainingTimeMs: status.remainingTimeMs || 0
          }
        })
        setStressStatuses(statusMap)
      }
    }

    socketService.on('stress:status', handleStressStatus)
    return () => socketService.off('stress:status', handleStressStatus)
  }, [device.id])

  // Countdown timer for active stress tests
  useEffect(() => {
    const interval = setInterval(() => {
      setStressStatuses(prev => {
        const updated = { ...prev }
        let hasChanges = false

        Object.keys(updated).forEach(type => {
          if (updated[type].isRunning && updated[type].remainingTimeMs > 0) {
            updated[type] = {
              ...updated[type],
              remainingTimeMs: Math.max(0, updated[type].remainingTimeMs - 1000)
            }
            hasChanges = true
          }
        })

        return hasChanges ? updated : prev
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleCPUPreset = async (percentage: number) => {
    if (!device.cpuInfo) return

    setLoading('cpu_preset')
    try {
      const targetFreq = Math.floor(device.cpuInfo.originalMaxFreq * (percentage / 100))
      const response = await socketService.setCPUFrequency(device.id, targetFreq)

      if (response.success) {
        showMessage(`CPU frequency set to ${percentage}%`, 'success')
        setSelectedFreq(targetFreq)
      } else {
        showMessage(response.message || 'Failed to set CPU frequency', 'error')
      }
    } catch (error) {
      showMessage('Error setting CPU frequency', 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleCustomFreq = async () => {
    if (!device.cpuInfo || !selectedFreq) return

    setLoading('custom_freq')
    try {
      const response = await socketService.setCPUFrequency(device.id, selectedFreq)

      if (response.success) {
        showMessage(`CPU frequency set to ${selectedFreq} kHz`, 'success')
      } else {
        showMessage(response.message || 'Failed to set CPU frequency', 'error')
      }
    } catch (error) {
      showMessage('Error setting CPU frequency', 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleRestore = async () => {
    setLoading('restore')
    try {
      const response = await socketService.restoreCPU(device.id)

      if (response.success) {
        showMessage('CPU frequency restored', 'success')
        setSelectedFreq(null)
      } else {
        showMessage(response.message || 'Failed to restore CPU', 'error')
      }
    } catch (error) {
      showMessage('Error restoring CPU', 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleTriggerANR = async (type: string, durationMs: number = 10000) => {
    setLoading(`anr_${type}`)
    try {
      const response = await socketService.triggerANR(device.id, type, durationMs)

      if (response.success) {
        showMessage(`ANR triggered: ${type}`, 'success')
      } else {
        showMessage(response.message || 'Failed to trigger ANR', 'error')
      }
    } catch (error) {
      showMessage('Error triggering ANR', 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleStartStress = async (type: 'cpu' | 'memory' | 'disk_io') => {
    setLoading(`stress_start_${type}`)
    try {
      const config = { ...stressConfigs[type], durationMs: 300000 }
      const response = await socketService.startStressTest(device.id, type, config)

      if (response.success) {
        showMessage(`${type.toUpperCase()} stress started`, 'success')
        setStressStatuses(prev => ({ ...prev, [type]: { isRunning: true, remainingTimeMs: 300000 } }))
      } else {
        showMessage(response.message || `Failed to start ${type} stress`, 'error')
      }
    } catch (error) {
      showMessage(`Error starting ${type} stress`, 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleStopStress = async (type: 'cpu' | 'memory' | 'disk_io') => {
    setLoading(`stress_stop_${type}`)
    try {
      const response = await socketService.stopStressTest(device.id, type)

      if (response.success) {
        showMessage(`${type.toUpperCase()} stress stopped`, 'success')
        setStressStatuses(prev => ({ ...prev, [type]: { isRunning: false, remainingTimeMs: 0 } }))
      } else {
        showMessage(response.message || `Failed to stop ${type} stress`, 'error')
      }
    } catch (error) {
      showMessage(`Error stopping ${type} stress`, 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleStopAllStress = async () => {
    setLoading('stress_stop_all')
    try {
      const response = await socketService.stopStressTest(device.id, 'all')

      if (response.success) {
        showMessage('All stress tests stopped', 'success')
        setStressStatuses({})
      } else {
        showMessage(response.message || 'Failed to stop stress tests', 'error')
      }
    } catch (error) {
      showMessage('Error stopping stress tests', 'error')
    } finally {
      setLoading(null)
    }
  }

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  const formatFrequency = (khz: number) => {
    if (khz >= 1000000) {
      return `${(khz / 1000000).toFixed(2)} GHz`
    }
    return `${(khz / 1000).toFixed(2)} MHz`
  }

  const activeStressCount = Object.values(stressStatuses).filter(s => s.isRunning).length

  return (
    <Card className="bg-white">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center shadow-sm">
              <Smartphone className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg">{device.model}</CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <span>Android {device.androidVersion}</span>
                <span>•</span>
                <span className={device.hasRoot ? 'text-green-600 font-medium' : 'text-slate-500'}>
                  {device.hasRoot ? 'Rooted' : 'Not Rooted'}
                </span>
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 bg-green-50 rounded-full border border-green-200">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-xs text-green-700 font-medium">Connected</span>
          </div>
        </div>

        {message && (
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg mt-4 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 flex-shrink-0" />
            )}
            <span className="text-sm font-medium">{message.text}</span>
          </div>
        )}
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="overview">
              <Info className="h-4 w-4 mr-1.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="cpu">
              <Cpu className="h-4 w-4 mr-1.5" />
              CPU
            </TabsTrigger>
            <TabsTrigger value="anr">
              <Zap className="h-4 w-4 mr-1.5" />
              ANR
            </TabsTrigger>
            <TabsTrigger value="stress">
              <Activity className="h-4 w-4 mr-1.5" />
              Stress {activeStressCount > 0 && `(${activeStressCount})`}
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-xs text-slate-500 mb-1">Device ID</div>
                <div className="text-sm font-mono font-medium text-slate-900 truncate">{device.id}</div>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-xs text-slate-500 mb-1">Android Version</div>
                <div className="text-sm font-semibold text-slate-900">{device.androidVersion}</div>
              </div>
            </div>

            {device.cpuInfo && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">CPU Information</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="text-xs text-blue-600 mb-1">Cores</div>
                    <div className="text-2xl font-bold text-blue-700">{device.cpuInfo.cores}</div>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="text-xs text-slate-500 mb-1">Original Max</div>
                    <div className="text-sm font-semibold text-slate-900">
                      {formatFrequency(device.cpuInfo.originalMaxFreq)}
                    </div>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <div className="text-xs text-green-600 mb-1">Current Max</div>
                    <div className="text-sm font-semibold text-green-700">
                      {formatFrequency(device.cpuInfo.currentMaxFreq)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Connection Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-600">Connected</span>
                  <span className="text-slate-900 font-medium">
                    {formatDistanceToNow(new Date(device.connectedAt), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-600">Last Seen</span>
                  <span className="text-slate-900 font-medium">
                    {formatDistanceToNow(new Date(device.lastSeen), { addSuffix: true })}
                  </span>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* CPU Control Tab */}
          <TabsContent value="cpu" className="space-y-5">
            {!device.hasRoot && (
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 text-amber-700 rounded-lg border border-amber-200">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span className="text-sm font-medium">Root access required for CPU control</span>
              </div>
            )}

            {device.cpuInfo && (
              <>
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Quick Presets</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {CPU_PRESETS.map((preset) => (
                      <Button
                        key={preset.name}
                        variant="outline"
                        size="sm"
                        onClick={() => handleCPUPreset(preset.percentage)}
                        disabled={!device.hasRoot || loading === 'cpu_preset'}
                        className="w-full h-12"
                      >
                        {loading === 'cpu_preset' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <div className="flex flex-col items-center">
                            <span className="font-semibold">{preset.name}</span>
                            <span className="text-xs text-slate-500">{preset.percentage}%</span>
                          </div>
                        )}
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Custom Frequency</h3>
                  <div className="flex gap-2">
                    <select
                      value={selectedFreq || ''}
                      onChange={(e) => setSelectedFreq(Number(e.target.value))}
                      disabled={!device.hasRoot || loading === 'custom_freq'}
                      className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="">Select frequency...</option>
                      {device.cpuInfo.availableFreqs.map((freq) => (
                        <option key={freq} value={freq}>
                          {formatFrequency(freq)}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCustomFreq}
                      disabled={!device.hasRoot || !selectedFreq || loading === 'custom_freq'}
                      className="px-6"
                    >
                      {loading === 'custom_freq' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Apply'
                      )}
                    </Button>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRestore}
                  disabled={!device.hasRoot || loading === 'restore'}
                  className="w-full border-orange-200 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
                >
                  {loading === 'restore' ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Restore Original Frequency
                </Button>
              </>
            )}
          </TabsContent>

          {/* ANR Testing Tab */}
          <TabsContent value="anr" className="space-y-4">
            <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-blue-700">
                These triggers will block the main thread and cause an ANR. The app will become unresponsive for 10 seconds.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {ANR_TRIGGERS.map((trigger) => (
                <Button
                  key={trigger.id}
                  variant="outline"
                  size="sm"
                  onClick={() => handleTriggerANR(trigger.id)}
                  disabled={loading === `anr_${trigger.id}`}
                  className="h-auto flex-col items-start py-3 px-4 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  title={trigger.description}
                >
                  {loading === `anr_${trigger.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  ) : (
                    <>
                      <span className="font-semibold text-sm">{trigger.name}</span>
                      <span className="text-xs text-red-500 mt-1">{trigger.description}</span>
                    </>
                  )}
                </Button>
              ))}
            </div>
          </TabsContent>

          {/* Stress Testing Tab */}
          <TabsContent value="stress" className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-blue-700">
                  <p className="font-medium mb-1">Background stress tests run for 5 minutes by default. Multiple tests can run concurrently.</p>
                  <p className="text-blue-600">Memory test continuously allocates until the target free memory is reached, then maintains that pressure.</p>
                </div>
              </div>
              {activeStressCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStopAllStress}
                  disabled={loading === 'stress_stop_all'}
                  className="border-orange-200 text-orange-600 hover:bg-orange-50 ml-2 flex-shrink-0"
                >
                  {loading === 'stress_stop_all' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Stop All'
                  )}
                </Button>
              )}
            </div>

            <div className="space-y-4">
              {STRESS_TESTS.map((test) => {
                const status = stressStatuses[test.id]
                const isRunning = status?.isRunning || false

                return (
                  <div key={test.id} className="p-4 border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <test.icon className="h-5 w-5 text-slate-600" />
                        <h4 className="font-semibold text-slate-900">{test.name}</h4>
                        {isRunning && (
                          <span className="flex items-center gap-1.5 px-2 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-200">
                            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                            Running
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-slate-600 mb-4">{test.description}</p>

                    {test.id === 'cpu' && (
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div>
                          <label className="text-xs font-medium text-slate-700 block mb-1.5">Threads</label>
                          <select
                            value={stressConfigs.cpu.threadCount}
                            onChange={(e) => setStressConfigs(prev => ({
                              ...prev,
                              cpu: { ...prev.cpu, threadCount: Number(e.target.value) }
                            }))}
                            disabled={isRunning}
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {test.options.threadCounts?.map(count => (
                              <option key={count} value={count}>{count} threads</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-700 block mb-1.5">Load</label>
                          <select
                            value={stressConfigs.cpu.loadPercentage}
                            onChange={(e) => setStressConfigs(prev => ({
                              ...prev,
                              cpu: { ...prev.cpu, loadPercentage: Number(e.target.value) }
                            }))}
                            disabled={isRunning}
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {test.options.loadPercentages?.map(load => (
                              <option key={load} value={load}>{load}%</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {test.id === 'memory' && (
                      <div className="mb-4">
                        <label className="text-xs font-medium text-slate-700 block mb-1.5">
                          Target Free Memory
                          <span className="text-slate-500 ml-1 font-normal">(lower = more pressure)</span>
                        </label>
                        <select
                          value={stressConfigs.memory.targetMemoryMB}
                          onChange={(e) => setStressConfigs(prev => ({
                            ...prev,
                            memory: { targetMemoryMB: Number(e.target.value) }
                          }))}
                          disabled={isRunning}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {test.options.targetFreeMemories?.map(mem => (
                            <option key={mem} value={mem}>{mem} MB free</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {test.id === 'disk_io' && (
                      <div className="mb-4">
                        <label className="text-xs font-medium text-slate-700 block mb-1.5">Throughput</label>
                        <select
                          value={stressConfigs.disk_io.throughputMBps}
                          onChange={(e) => setStressConfigs(prev => ({
                            ...prev,
                            disk_io: { throughputMBps: Number(e.target.value) }
                          }))}
                          disabled={isRunning}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {test.options.throughputs?.map(tp => (
                            <option key={tp} value={tp}>{tp} MB/s</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="flex gap-2">
                      {!isRunning ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartStress(test.id as any)}
                          disabled={loading === `stress_start_${test.id}`}
                          className="flex-1 border-green-200 text-green-600 hover:bg-green-50 hover:text-green-700 h-10"
                        >
                          {loading === `stress_start_${test.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Clock className="h-4 w-4 mr-2" />
                          )}
                          Start (5 minutes)
                        </Button>
                      ) : (
                        <>
                          <div className="flex-1 flex items-center justify-center px-4 py-2 bg-slate-50 rounded-lg border border-slate-200">
                            <Clock className="h-4 w-4 mr-2 text-slate-600" />
                            <span className="text-sm font-medium text-slate-900">
                              {formatTime(status.remainingTimeMs)} remaining
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStopStress(test.id as any)}
                            disabled={loading === `stress_stop_${test.id}`}
                            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 px-6"
                          >
                            {loading === `stress_stop_${test.id}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Stop'
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

export default function DevicesPage() {
  const { devices, isConnected } = useDevices()

  return (
    <div className="container mx-auto px-4 py-8 lg:px-8 max-w-7xl">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Device Control</h1>
            <p className="text-slate-600 mt-1">Remote control and testing for connected Android devices</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-sm font-medium text-slate-700">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {devices.length === 0 ? (
        <Card className="bg-white border-2 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <Smartphone className="h-10 w-10 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No devices connected</h3>
            <p className="text-sm text-slate-500 text-center max-w-md">
              Connect an Android device with the DANR SDK installed to start remote control and testing.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {devices.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))}
        </div>
      )}
    </div>
  )
}
