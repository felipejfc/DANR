'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Wifi,
  Thermometer,
  Play,
  Square,
  RefreshCw,
  AlertTriangle,
  Server,
  Smartphone,
  Gauge,
  Loader2,
  CheckCircle2
} from 'lucide-react'
import { stressApi, AllStressStatus, StressStatus } from '@/lib/stressApi'
import { socketService, Device } from '@/lib/socket'

function formatTime(ms: number): string {
  if (ms <= 0) return '0:00'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function formatFrequency(freqKHz: number): string {
  if (freqKHz >= 1000000) {
    return `${(freqKHz / 1000000).toFixed(2)} GHz`
  }
  return `${(freqKHz / 1000).toFixed(0)} MHz`
}

function StressStatusBadge({ status }: { status: StressStatus }) {
  if (status.isRunning) {
    return (
      <Badge className="bg-green-100 text-green-700 border-green-200">
        Running - {formatTime(status.remainingTimeMs)}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-slate-500">
      Stopped
    </Badge>
  )
}

interface StressPanelProps {
  title: string
  description: string
  icon: React.ReactNode
  status: StressStatus | null
  isLoading: boolean
  onStart: () => Promise<void>
  onStop: () => Promise<void>
  children?: React.ReactNode
}

function StressPanel({ title, description, icon, status, isLoading, onStart, onStop, children }: StressPanelProps) {
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)

  const handleStart = async () => {
    setIsStarting(true)
    try {
      await onStart()
    } finally {
      setIsStarting(false)
    }
  }

  const handleStop = async () => {
    setIsStopping(true)
    try {
      await onStop()
    } finally {
      setIsStopping(false)
    }
  }

  const isRunning = status?.isRunning ?? false

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 rounded-lg">
              {icon}
            </div>
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          {status && <StressStatusBadge status={status} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}

        {/* Status data */}
        {status?.isRunning && Object.keys(status.data).length > 0 && (
          <div className="bg-slate-50 rounded-lg p-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(status.data).map(([key, value]) => (
                <div key={key}>
                  <span className="text-slate-500">{key}: </span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {isRunning ? (
            <Button
              variant="destructive"
              onClick={handleStop}
              disabled={isStopping || isLoading}
              className="w-full"
            >
              <Square className="h-4 w-4 mr-2" />
              {isStopping ? 'Stopping...' : 'Stop'}
            </Button>
          ) : (
            <Button
              onClick={handleStart}
              disabled={isStarting || isLoading}
              className="w-full"
            >
              <Play className="h-4 w-4 mr-2" />
              {isStarting ? 'Starting...' : 'Start'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// CPU Frequency Control Card
function CPUFrequencyCard({ device, onRefresh }: { device: Device; onRefresh: () => void }) {
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const handleSetFrequency = async (percentage: number) => {
    if (!device.cpuInfo) return

    const maxFreq = device.cpuInfo.originalMaxFreq
    const targetFreq = Math.floor((maxFreq * percentage) / 100)

    setLoading(`freq-${percentage}`)
    setMessage(null)

    try {
      const response = await socketService.setCPUFrequency(device.id, targetFreq)
      if (response.success) {
        setMessage({ text: `CPU frequency set to ${percentage}%`, type: 'success' })
        onRefresh()
      } else {
        setMessage({ text: response.message || 'Failed to set frequency', type: 'error' })
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Failed', type: 'error' })
    } finally {
      setLoading(null)
    }
  }

  const handleRestore = async () => {
    setLoading('restore')
    setMessage(null)

    try {
      const response = await socketService.restoreCPU(device.id)
      if (response.success) {
        setMessage({ text: 'CPU frequency restored', type: 'success' })
        onRefresh()
      } else {
        setMessage({ text: response.message || 'Failed to restore', type: 'error' })
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Failed', type: 'error' })
    } finally {
      setLoading(null)
    }
  }

  const cpuInfo = device.cpuInfo
  const currentPercent = cpuInfo
    ? Math.round((cpuInfo.currentMaxFreq / cpuInfo.originalMaxFreq) * 100)
    : 100

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Gauge className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <CardTitle className="text-lg">CPU Frequency Control</CardTitle>
            <CardDescription>Limit CPU frequency via SDK (requires root)</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {cpuInfo ? (
          <>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-500">Current Max: </span>
                <span className="font-medium">{formatFrequency(cpuInfo.currentMaxFreq)}</span>
              </div>
              <div>
                <span className="text-slate-500">Original Max: </span>
                <span className="font-medium">{formatFrequency(cpuInfo.originalMaxFreq)}</span>
              </div>
              <div>
                <span className="text-slate-500">Cores: </span>
                <span className="font-medium">{cpuInfo.cores}</span>
              </div>
              <div>
                <span className="text-slate-500">Current: </span>
                <Badge variant={currentPercent < 100 ? 'default' : 'outline'}>
                  {currentPercent}%
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[100, 75, 50, 25].map((pct) => (
                <Button
                  key={pct}
                  variant={currentPercent === pct ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleSetFrequency(pct)}
                  disabled={loading !== null}
                >
                  {loading === `freq-${pct}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `${pct}%`
                  )}
                </Button>
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleRestore}
              disabled={loading !== null}
            >
              {loading === 'restore' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Restore Original
            </Button>
          </>
        ) : (
          <p className="text-sm text-slate-500">CPU info not available. Device may not have root access.</p>
        )}

        {message && (
          <div className={`text-sm px-3 py-2 rounded ${
            message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {message.text}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function StressTestingPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [deviceUrl, setDeviceUrl] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isDaemonConnecting, setIsDaemonConnecting] = useState(false)
  const [status, setStatus] = useState<AllStressStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Config states
  const [cpuThreads, setCpuThreads] = useState(4)
  const [cpuLoad, setCpuLoad] = useState(100)
  const [cpuDuration, setCpuDuration] = useState(300)

  const [memoryTarget, setMemoryTarget] = useState(100)
  const [memoryDuration, setMemoryDuration] = useState(300)

  const [diskThroughput, setDiskThroughput] = useState(5)
  const [diskDuration, setDiskDuration] = useState(300)

  const [networkBandwidth, setNetworkBandwidth] = useState(1000)
  const [networkLatency, setNetworkLatency] = useState(100)
  const [networkLoss, setNetworkLoss] = useState(0)
  const [networkDuration, setNetworkDuration] = useState(300)

  const [thermalFreqPercent, setThermalFreqPercent] = useState(100)
  const [thermalForceAllCores, setThermalForceAllCores] = useState(true)
  const [thermalDuration, setThermalDuration] = useState(300)

  // Connect to socket and listen for device updates
  useEffect(() => {
    socketService.connect()
    socketService.requestDeviceList()

    const handleDevicesUpdated = (data: { devices: Device[] }) => {
      setDevices(data.devices || [])
    }

    socketService.on('devices:updated', handleDevicesUpdated)

    return () => {
      socketService.off('devices:updated', handleDevicesUpdated)
    }
  }, [])

  // Auto-select first device if none selected
  useEffect(() => {
    if (!selectedDevice && devices.length > 0) {
      setSelectedDevice(devices[0])
    }
  }, [devices, selectedDevice])

  // Auto-populate device URL when device is selected
  useEffect(() => {
    if (selectedDevice?.ipAddress && !isConnected) {
      setDeviceUrl(`http://${selectedDevice.ipAddress}:8765`)
    }
  }, [selectedDevice, isConnected])

  const fetchStatus = useCallback(async () => {
    if (!isConnected) return

    try {
      const newStatus = await stressApi.getStatus()
      setStatus(newStatus)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status')
    }
  }, [isConnected])

  // Poll status while connected
  useEffect(() => {
    if (!isConnected) return

    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => clearInterval(interval)
  }, [isConnected, fetchStatus])

  const handleConnect = async (url?: string) => {
    const targetUrl = url || deviceUrl
    if (!targetUrl) {
      setError('Please enter a device URL')
      return
    }

    setIsDaemonConnecting(true)
    setError(null)

    try {
      stressApi.setDeviceUrl(targetUrl)
      const newStatus = await stressApi.getStatus()
      setStatus(newStatus)
      setIsConnected(true)
      setDeviceUrl(targetUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to daemon')
      setIsConnected(false)
    } finally {
      setIsDaemonConnecting(false)
    }
  }

  const handleAutoConnect = async (device: Device) => {
    if (!device.ipAddress) {
      setError('Device IP address not available')
      return
    }
    setSelectedDevice(device)
    await handleConnect(`http://${device.ipAddress}:8765`)
  }

  const handleDisconnect = () => {
    setIsConnected(false)
    setStatus(null)
  }

  const handleStopAll = async () => {
    setIsLoading(true)
    try {
      await stressApi.stopAll()
      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop all')
    } finally {
      setIsLoading(false)
    }
  }

  const refreshDevices = () => {
    socketService.requestDeviceList()
  }

  const isAnyRunning = status && (
    status.cpu.isRunning ||
    status.memory.isRunning ||
    status.disk_io.isRunning ||
    status.network.isRunning ||
    status.thermal.isRunning
  )

  if (!isConnected) {
    return (
      <div className="container mx-auto px-4 py-8 lg:px-8 max-w-3xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <Server className="h-8 w-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            System Daemon Stress Testing
          </h1>
          <p className="text-slate-600">
            Connect to a device&apos;s DANR daemon to run system-level stress tests
          </p>
        </div>

        {/* Detected Devices */}
        {devices.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Smartphone className="h-5 w-5 text-slate-600" />
                  <div>
                    <CardTitle className="text-lg">Detected Devices</CardTitle>
                    <CardDescription>Devices connected via SDK</CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={refreshDevices}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {devices.map((device) => (
                  <div
                    key={device.id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      selectedDevice?.id === device.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <div>
                        <p className="font-medium text-sm">{device.model}</p>
                        <p className="text-xs text-slate-500">
                          Android {device.androidVersion}
                          {device.ipAddress && ` • ${device.ipAddress}`}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleAutoConnect(device)}
                      disabled={isDaemonConnecting || !device.ipAddress}
                    >
                      {isDaemonConnecting && selectedDevice?.id === device.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Connect'
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Manual Connection */}
        <Card>
          <CardHeader>
            <CardTitle>Manual Connection</CardTitle>
            <CardDescription>
              Enter the URL of the device&apos;s DANR daemon (e.g., http://192.168.1.100:8765)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Device URL
              </label>
              <input
                type="text"
                value={deviceUrl}
                onChange={(e) => setDeviceUrl(e.target.value)}
                placeholder="http://192.168.1.100:8765"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <Button onClick={() => handleConnect()} disabled={isDaemonConnecting} className="w-full">
              {isDaemonConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 lg:px-8">
      <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            System Daemon Stress Testing
          </h1>
          <p className="text-slate-600 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Connected to: <span className="font-medium">{deviceUrl}</span>
            {selectedDevice && (
              <span className="text-slate-400">({selectedDevice.model})</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchStatus} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {isAnyRunning && (
            <Button variant="destructive" onClick={handleStopAll} disabled={isLoading}>
              <Square className="h-4 w-4 mr-2" />
              Stop All
            </Button>
          )}
          <Button variant="outline" onClick={handleDisconnect}>
            Disconnect
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Warning Banner */}
      <Card className="mb-6 border-amber-200 bg-amber-50">
        <CardContent className="flex items-center gap-3 py-4">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            These stress tests run as root and can significantly impact device performance.
            Network and thermal controls modify system settings.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CPU Frequency Control (via SDK) */}
        {selectedDevice && (
          <CPUFrequencyCard device={selectedDevice} onRefresh={refreshDevices} />
        )}

        {/* CPU Stress */}
        <StressPanel
          title="CPU Stress"
          description="Multi-threaded CPU load using math operations"
          icon={<Cpu className="h-5 w-5 text-slate-600" />}
          status={status?.cpu ?? null}
          isLoading={isLoading}
          onStart={async () => {
            await stressApi.startCpu({
              threadCount: cpuThreads,
              loadPercentage: cpuLoad,
              durationMs: cpuDuration * 1000,
            })
            await fetchStatus()
          }}
          onStop={async () => {
            await stressApi.stopCpu()
            await fetchStatus()
          }}
        >
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Threads</label>
              <input
                type="number"
                value={cpuThreads}
                onChange={(e) => setCpuThreads(parseInt(e.target.value) || 1)}
                min={1}
                max={16}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Load %</label>
              <input
                type="number"
                value={cpuLoad}
                onChange={(e) => setCpuLoad(parseInt(e.target.value) || 1)}
                min={1}
                max={100}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Duration (s)</label>
              <input
                type="number"
                value={cpuDuration}
                onChange={(e) => setCpuDuration(parseInt(e.target.value) || 60)}
                min={10}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>
        </StressPanel>

        {/* Memory Stress */}
        <StressPanel
          title="Memory Stress"
          description="Allocate memory to reach target free memory"
          icon={<MemoryStick className="h-5 w-5 text-slate-600" />}
          status={status?.memory ?? null}
          isLoading={isLoading}
          onStart={async () => {
            await stressApi.startMemory({
              targetFreeMB: memoryTarget,
              durationMs: memoryDuration * 1000,
            })
            await fetchStatus()
          }}
          onStop={async () => {
            await stressApi.stopMemory()
            await fetchStatus()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Target Free (MB)</label>
              <input
                type="number"
                value={memoryTarget}
                onChange={(e) => setMemoryTarget(parseInt(e.target.value) || 100)}
                min={50}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Duration (s)</label>
              <input
                type="number"
                value={memoryDuration}
                onChange={(e) => setMemoryDuration(parseInt(e.target.value) || 60)}
                min={10}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>
        </StressPanel>

        {/* Disk Stress */}
        <StressPanel
          title="Disk I/O Stress"
          description="Read/write operations at target throughput"
          icon={<HardDrive className="h-5 w-5 text-slate-600" />}
          status={status?.disk_io ?? null}
          isLoading={isLoading}
          onStart={async () => {
            await stressApi.startDisk({
              throughputMBps: diskThroughput,
              durationMs: diskDuration * 1000,
            })
            await fetchStatus()
          }}
          onStop={async () => {
            await stressApi.stopDisk()
            await fetchStatus()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Throughput (MB/s)</label>
              <input
                type="number"
                value={diskThroughput}
                onChange={(e) => setDiskThroughput(parseInt(e.target.value) || 1)}
                min={1}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Duration (s)</label>
              <input
                type="number"
                value={diskDuration}
                onChange={(e) => setDiskDuration(parseInt(e.target.value) || 60)}
                min={10}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>
        </StressPanel>

        {/* Network Stress */}
        <StressPanel
          title="Network Stress"
          description="Traffic shaping via tc (root required)"
          icon={<Wifi className="h-5 w-5 text-slate-600" />}
          status={status?.network ?? null}
          isLoading={isLoading}
          onStart={async () => {
            await stressApi.startNetwork({
              bandwidthLimitKbps: networkBandwidth,
              latencyMs: networkLatency,
              packetLossPercent: networkLoss,
              durationMs: networkDuration * 1000,
            })
            await fetchStatus()
          }}
          onStop={async () => {
            await stressApi.stopNetwork()
            await fetchStatus()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Bandwidth (kbps)</label>
              <input
                type="number"
                value={networkBandwidth}
                onChange={(e) => setNetworkBandwidth(parseInt(e.target.value) || 0)}
                min={0}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Latency (ms)</label>
              <input
                type="number"
                value={networkLatency}
                onChange={(e) => setNetworkLatency(parseInt(e.target.value) || 0)}
                min={0}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Packet Loss %</label>
              <input
                type="number"
                value={networkLoss}
                onChange={(e) => setNetworkLoss(parseInt(e.target.value) || 0)}
                min={0}
                max={100}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Duration (s)</label>
              <input
                type="number"
                value={networkDuration}
                onChange={(e) => setNetworkDuration(parseInt(e.target.value) || 60)}
                min={10}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>
        </StressPanel>

        {/* Thermal Stress */}
        <StressPanel
          title="Thermal / CPU Control"
          description="CPU frequency and core control (root required)"
          icon={<Thermometer className="h-5 w-5 text-slate-600" />}
          status={status?.thermal ?? null}
          isLoading={isLoading}
          onStart={async () => {
            await stressApi.startThermal({
              maxFrequencyPercent: thermalFreqPercent,
              forceAllCoresOnline: thermalForceAllCores,
              durationMs: thermalDuration * 1000,
            })
            await fetchStatus()
          }}
          onStop={async () => {
            await stressApi.stopThermal()
            await fetchStatus()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Max Freq %</label>
              <input
                type="number"
                value={thermalFreqPercent}
                onChange={(e) => setThermalFreqPercent(parseInt(e.target.value) || 100)}
                min={10}
                max={100}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Duration (s)</label>
              <input
                type="number"
                value={thermalDuration}
                onChange={(e) => setThermalDuration(parseInt(e.target.value) || 60)}
                min={10}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={thermalForceAllCores}
                  onChange={(e) => setThermalForceAllCores(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span className="text-slate-700">Force all cores online</span>
              </label>
            </div>
          </div>
        </StressPanel>
      </div>
    </div>
  )
}
