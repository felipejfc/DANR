'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useDevices } from '@/hooks/useDevices'
import { socketService, Device } from '@/lib/socket'
import { stressApi, ModuleConfig, DanrConfig, PackageInfo, AllStressStatus } from '@/lib/stressApi'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  Gauge,
  Settings,
  Package,
  Search,
  FileText,
  Server,
  Plus,
  X,
  HardDrive,
  MemoryStick,
  Wifi,
  Thermometer,
  Play,
  Square
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

// Constants
const ANR_TRIGGERS = [
  { id: 'infinite_loop', name: 'Infinite Loop', description: 'Blocks main thread with busy loop' },
  { id: 'sleep', name: 'Sleep', description: 'Main thread sleeps for duration' },
  { id: 'heavy_computation', name: 'Heavy Computation', description: 'CPU-intensive calculation' },
  { id: 'memory_stress', name: 'Memory Stress', description: 'Allocates large arrays' },
  { id: 'disk_io', name: 'Disk I/O', description: 'Synchronous file operations' },
  { id: 'network', name: 'Network Request', description: 'Synchronous network call' },
]

const CPU_PRESETS = [
  { name: '100%', percentage: 100 },
  { name: '75%', percentage: 75 },
  { name: '50%', percentage: 50 },
  { name: '25%', percentage: 25 },
]

const defaultConfig: ModuleConfig = {
  whitelist: [],
  danrConfig: {
    backendUrl: 'http://localhost:8080',
    anrThresholdMs: 5000,
    enableInRelease: true,
    enableInDebug: true,
    autoStart: true
  }
}

// Helper functions
function formatTime(ms: number): string {
  if (ms <= 0) return '0:00'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function formatFrequency(khz: number): string {
  if (khz >= 1000000) {
    return `${(khz / 1000000).toFixed(2)} GHz`
  }
  return `${(khz / 1000).toFixed(0)} MHz`
}

// Device Control Panel Component
interface DeviceControlPanelProps {
  device: Device
}

function DeviceControlPanel({ device }: DeviceControlPanelProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // CPU state
  const [selectedFreq, setSelectedFreq] = useState<number | null>(null)

  // SDK Stress state
  const [sdkStressStatuses, setSdkStressStatuses] = useState<Record<string, { isRunning: boolean; remainingTimeMs: number }>>({})
  const [sdkStressConfigs, setSdkStressConfigs] = useState({
    cpu: { threadCount: 4, loadPercentage: 100 },
    memory: { targetMemoryMB: 100 },
    disk_io: { throughputMBps: 5 },
  })

  // Daemon connection state
  const [isDaemonConnected, setIsDaemonConnected] = useState(false)
  const [isDaemonConnecting, setIsDaemonConnecting] = useState(false)

  // Daemon stress state
  const [daemonStressStatus, setDaemonStressStatus] = useState<AllStressStatus | null>(null)
  const [daemonStressConfigs, setDaemonStressConfigs] = useState({
    cpu: { threadCount: 4, loadPercentage: 100, durationMs: 300 },
    memory: { targetFreeMB: 100, durationMs: 300 },
    disk: { throughputMBps: 5, durationMs: 300 },
    network: { bandwidthLimitKbps: 1000, latencyMs: 100, packetLossPercent: 0, durationMs: 300 },
    thermal: { maxFrequencyPercent: 100, forceAllCoresOnline: true, durationMs: 300 },
  })

  // Module config state
  const [config, setConfig] = useState<ModuleConfig>(defaultConfig)
  const [packages, setPackages] = useState<PackageInfo[]>([])
  const [packagesLoading, setPackagesLoading] = useState(false)
  const [packageSearch, setPackageSearch] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // Logs state
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)

  // Auto-save ref
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch SDK stress status
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
          setSdkStressStatuses(statusMap)
        }
      } catch (error) {
        console.error('Failed to fetch stress status:', error)
      }
    }
    fetchStatus()
  }, [device.id])

  // Listen for real-time SDK stress status updates
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
        setSdkStressStatuses(statusMap)
      }
    }

    socketService.on('stress:status', handleStressStatus)
    return () => socketService.off('stress:status', handleStressStatus)
  }, [device.id])

  // Auto-connect to daemon when device has IP
  useEffect(() => {
    if (device.ipAddress && !isDaemonConnected && !isDaemonConnecting) {
      connectToDaemon()
    }
  }, [device.ipAddress])

  // Poll daemon stress status
  useEffect(() => {
    if (!isDaemonConnected) return

    const fetchDaemonStatus = async () => {
      try {
        const status = await stressApi.getStatus()
        setDaemonStressStatus(status)
      } catch (err) {
        // Silently fail - daemon may be temporarily unavailable
      }
    }

    fetchDaemonStatus()
    const interval = setInterval(fetchDaemonStatus, 2000)
    return () => clearInterval(interval)
  }, [isDaemonConnected])

  // Cleanup auto-save timeout
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  // Countdown timer for SDK stress tests
  useEffect(() => {
    const interval = setInterval(() => {
      setSdkStressStatuses(prev => {
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

  const connectToDaemon = async () => {
    if (!device.ipAddress) return

    setIsDaemonConnecting(true)
    const daemonUrl = `http://${device.ipAddress}:8765`

    try {
      stressApi.setDeviceUrl(daemonUrl)
      const newConfig = await stressApi.getConfig()
      setConfig(newConfig)
      setIsDaemonConnected(true)

      // Also fetch packages
      try {
        const pkgs = await stressApi.getPackages()
        setPackages(pkgs)
      } catch {}
    } catch (err) {
      // Daemon not available - that's ok, some features won't work
      setIsDaemonConnected(false)
    } finally {
      setIsDaemonConnecting(false)
    }
  }

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  // CPU Control handlers
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

  // ANR handler
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

  // SDK Stress handlers
  const handleStartSdkStress = async (type: 'cpu' | 'memory' | 'disk_io') => {
    setLoading(`sdk_stress_start_${type}`)
    try {
      const config = { ...sdkStressConfigs[type], durationMs: 300000 }
      const response = await socketService.startStressTest(device.id, type, config)

      if (response.success) {
        showMessage(`${type.toUpperCase()} stress started`, 'success')
        setSdkStressStatuses(prev => ({ ...prev, [type]: { isRunning: true, remainingTimeMs: 300000 } }))
      } else {
        showMessage(response.message || `Failed to start ${type} stress`, 'error')
      }
    } catch (error) {
      showMessage(`Error starting ${type} stress`, 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleStopSdkStress = async (type: 'cpu' | 'memory' | 'disk_io') => {
    setLoading(`sdk_stress_stop_${type}`)
    try {
      const response = await socketService.stopStressTest(device.id, type)

      if (response.success) {
        showMessage(`${type.toUpperCase()} stress stopped`, 'success')
        setSdkStressStatuses(prev => ({ ...prev, [type]: { isRunning: false, remainingTimeMs: 0 } }))
      } else {
        showMessage(response.message || `Failed to stop ${type} stress`, 'error')
      }
    } catch (error) {
      showMessage(`Error stopping ${type} stress`, 'error')
    } finally {
      setLoading(null)
    }
  }

  // Daemon stress handlers
  const handleDaemonStressAction = async (
    type: 'cpu' | 'memory' | 'disk' | 'network' | 'thermal',
    action: 'start' | 'stop'
  ) => {
    if (!isDaemonConnected) return

    setLoading(`daemon_${type}_${action}`)
    try {
      if (action === 'start') {
        const configKey = type as keyof typeof daemonStressConfigs
        const cfg = daemonStressConfigs[configKey]
        const durationMs = cfg.durationMs * 1000

        switch (type) {
          case 'cpu':
            await stressApi.startCpu({ ...cfg, durationMs })
            break
          case 'memory':
            await stressApi.startMemory({ targetFreeMB: cfg.targetFreeMB, durationMs })
            break
          case 'disk':
            await stressApi.startDisk({ throughputMBps: cfg.throughputMBps, durationMs })
            break
          case 'network':
            await stressApi.startNetwork({ ...cfg, durationMs })
            break
          case 'thermal':
            await stressApi.startThermal({ ...cfg, durationMs })
            break
        }
        showMessage(`${type} stress started`, 'success')
      } else {
        switch (type) {
          case 'cpu': await stressApi.stopCpu(); break
          case 'memory': await stressApi.stopMemory(); break
          case 'disk': await stressApi.stopDisk(); break
          case 'network': await stressApi.stopNetwork(); break
          case 'thermal': await stressApi.stopThermal(); break
        }
        showMessage(`${type} stress stopped`, 'success')
      }
    } catch (err) {
      showMessage(`Failed to ${action} ${type} stress`, 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleStopAllDaemonStress = async () => {
    if (!isDaemonConnected) return

    setLoading('daemon_stop_all')
    try {
      await stressApi.stopAll()
      showMessage('All stress tests stopped', 'success')
    } catch (err) {
      showMessage('Failed to stop all stress tests', 'error')
    } finally {
      setLoading(null)
    }
  }

  // Config handlers
  const autoSaveConfig = useCallback(async (configToSave: ModuleConfig) => {
    if (!isDaemonConnected) return

    setSaveStatus('saving')
    try {
      await stressApi.saveConfig(configToSave)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [isDaemonConnected])

  const triggerAutoSave = useCallback((newConfig: ModuleConfig) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      autoSaveConfig(newConfig)
    }, 800)
  }, [autoSaveConfig])

  const updateConfig = (newConfig: ModuleConfig) => {
    setConfig(newConfig)
    triggerAutoSave(newConfig)
  }

  const handleAddToWhitelist = (packageName: string) => {
    if (!config.whitelist.includes(packageName)) {
      updateConfig({ ...config, whitelist: [...config.whitelist, packageName] })
    }
  }

  const handleRemoveFromWhitelist = (packageName: string) => {
    updateConfig({ ...config, whitelist: config.whitelist.filter(p => p !== packageName) })
  }

  const handleDanrConfigChange = (key: keyof DanrConfig, value: string | number | boolean) => {
    updateConfig({ ...config, danrConfig: { ...config.danrConfig, [key]: value } })
  }

  // Packages
  const fetchPackages = async () => {
    if (!isDaemonConnected) return
    setPackagesLoading(true)
    try {
      const pkgs = await stressApi.getPackages()
      setPackages(pkgs)
    } catch {} finally {
      setPackagesLoading(false)
    }
  }

  const filteredPackages = packages.filter(pkg => {
    const searchLower = packageSearch.toLowerCase()
    const isNotInWhitelist = !config.whitelist.includes(pkg.package)
    return isNotInWhitelist && (
      pkg.package.toLowerCase().includes(searchLower) ||
      (pkg.label && pkg.label.toLowerCase().includes(searchLower))
    )
  })

  const getPackageInfo = (packageName: string) => packages.find(p => p.package === packageName)

  // Logs
  const fetchLogs = async () => {
    if (!isDaemonConnected) return
    setLogsLoading(true)
    try {
      const logText = await stressApi.getLogs()
      setLogs(logText)
    } catch {} finally {
      setLogsLoading(false)
    }
  }

  const activeSdkStressCount = Object.values(sdkStressStatuses).filter(s => s.isRunning).length
  const activeDaemonStressCount = daemonStressStatus ?
    [daemonStressStatus.cpu, daemonStressStatus.memory, daemonStressStatus.disk_io, daemonStressStatus.network, daemonStressStatus.thermal]
      .filter(s => s?.isRunning).length : 0

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
                {device.ipAddress && (
                  <>
                    <span>•</span>
                    <span className="font-mono text-xs">{device.ipAddress}</span>
                  </>
                )}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDaemonConnected ? (
              <Badge className="bg-green-100 text-green-700 border-green-200">
                <Server className="h-3 w-3 mr-1" />
                Daemon
              </Badge>
            ) : isDaemonConnecting ? (
              <Badge variant="outline" className="text-slate-500">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Connecting...
              </Badge>
            ) : device.ipAddress ? (
              <Button variant="outline" size="sm" onClick={connectToDaemon}>
                Connect Daemon
              </Button>
            ) : null}
            <div className="flex items-center gap-2 px-2 py-1 bg-green-50 rounded-full border border-green-200">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs text-green-700 font-medium">Connected</span>
            </div>
          </div>
        </div>

        {message && (
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg mt-4 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            <span className="text-sm font-medium">{message.text}</span>
          </div>
        )}
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => {
          setActiveTab(v)
          if (v === 'logs' && isDaemonConnected) fetchLogs()
        }}>
          <TabsList className="w-full flex flex-wrap h-auto gap-1 p-1">
            <TabsTrigger value="overview" className="flex-1 min-w-[80px]">
              <Info className="h-4 w-4 mr-1.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="cpu" className="flex-1 min-w-[80px]">
              <Cpu className="h-4 w-4 mr-1.5" />
              CPU
            </TabsTrigger>
            <TabsTrigger value="anr" className="flex-1 min-w-[80px]">
              <Zap className="h-4 w-4 mr-1.5" />
              ANR
            </TabsTrigger>
            <TabsTrigger value="stress" className="flex-1 min-w-[80px]">
              <Activity className="h-4 w-4 mr-1.5" />
              Stress {(activeSdkStressCount + activeDaemonStressCount) > 0 && `(${activeSdkStressCount + activeDaemonStressCount})`}
            </TabsTrigger>
            <TabsTrigger value="config" className="flex-1 min-w-[80px]">
              <Settings className="h-4 w-4 mr-1.5" />
              Config
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex-1 min-w-[80px]">
              <FileText className="h-4 w-4 mr-1.5" />
              Logs
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
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
                {device.ipAddress && (
                  <div className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
                    <span className="text-slate-600">Daemon Status</span>
                    <span className={`font-medium ${isDaemonConnected ? 'text-green-600' : 'text-slate-500'}`}>
                      {isDaemonConnected ? 'Connected' : 'Not Connected'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* CPU Control Tab */}
          <TabsContent value="cpu" className="space-y-5 mt-4">
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
                  <div className="grid grid-cols-4 gap-2">
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
                          <span className="font-semibold">{preset.name}</span>
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
                      disabled={!device.hasRoot}
                      className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select frequency...</option>
                      {device.cpuInfo.availableFreqs.map((freq) => (
                        <option key={freq} value={freq}>{formatFrequency(freq)}</option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        if (!selectedFreq) return
                        setLoading('custom_freq')
                        try {
                          const response = await socketService.setCPUFrequency(device.id, selectedFreq)
                          if (response.success) showMessage(`CPU frequency set`, 'success')
                          else showMessage(response.message || 'Failed', 'error')
                        } catch { showMessage('Error', 'error') }
                        finally { setLoading(null) }
                      }}
                      disabled={!device.hasRoot || !selectedFreq || loading === 'custom_freq'}
                      className="px-6"
                    >
                      {loading === 'custom_freq' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                    </Button>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRestore}
                  disabled={!device.hasRoot || loading === 'restore'}
                  className="w-full border-orange-200 text-orange-600 hover:bg-orange-50"
                >
                  {loading === 'restore' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Restore Original Frequency
                </Button>
              </>
            )}
          </TabsContent>

          {/* ANR Testing Tab */}
          <TabsContent value="anr" className="space-y-4 mt-4">
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
                  className="h-auto flex-col items-start py-3 px-4 border-red-200 text-red-600 hover:bg-red-50"
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
          <TabsContent value="stress" className="space-y-6 mt-4">
            {/* SDK-based stress tests */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700">SDK Stress Tests</h3>
                {activeSdkStressCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      setLoading('sdk_stop_all')
                      await socketService.stopStressTest(device.id, 'all')
                      setSdkStressStatuses({})
                      setLoading(null)
                    }}
                    disabled={loading === 'sdk_stop_all'}
                    className="text-xs border-orange-200 text-orange-600 hover:bg-orange-50"
                  >
                    Stop All SDK
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'cpu', name: 'CPU', icon: Cpu, configKey: 'cpu' },
                  { id: 'memory', name: 'Memory', icon: MemoryStick, configKey: 'memory' },
                  { id: 'disk_io', name: 'Disk I/O', icon: HardDrive, configKey: 'disk_io' },
                ].map((test) => {
                  const status = sdkStressStatuses[test.id]
                  const isRunning = status?.isRunning || false

                  return (
                    <div key={test.id} className="p-3 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <test.icon className="h-4 w-4 text-slate-600" />
                          <span className="text-sm font-medium">{test.name}</span>
                        </div>
                        {isRunning && (
                          <Badge className="bg-green-100 text-green-700 text-xs">
                            {formatTime(status.remainingTimeMs)}
                          </Badge>
                        )}
                      </div>

                      <Button
                        variant={isRunning ? "destructive" : "outline"}
                        size="sm"
                        className="w-full"
                        onClick={() => isRunning ? handleStopSdkStress(test.id as any) : handleStartSdkStress(test.id as any)}
                        disabled={loading?.startsWith('sdk_stress')}
                      >
                        {loading === `sdk_stress_${isRunning ? 'stop' : 'start'}_${test.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isRunning ? (
                          <><Square className="h-3 w-3 mr-1" /> Stop</>
                        ) : (
                          <><Play className="h-3 w-3 mr-1" /> Start</>
                        )}
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Daemon-based stress tests */}
            {isDaemonConnected && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-700">Daemon Stress Tests (Advanced)</h3>
                  {activeDaemonStressCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleStopAllDaemonStress}
                      disabled={loading === 'daemon_stop_all'}
                      className="text-xs border-orange-200 text-orange-600 hover:bg-orange-50"
                    >
                      Stop All Daemon
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { id: 'cpu', name: 'CPU', icon: Cpu, status: daemonStressStatus?.cpu },
                    { id: 'memory', name: 'Memory', icon: MemoryStick, status: daemonStressStatus?.memory },
                    { id: 'disk', name: 'Disk I/O', icon: HardDrive, status: daemonStressStatus?.disk_io },
                    { id: 'network', name: 'Network', icon: Wifi, status: daemonStressStatus?.network },
                    { id: 'thermal', name: 'Thermal', icon: Thermometer, status: daemonStressStatus?.thermal },
                  ].map((test) => {
                    const isRunning = test.status?.isRunning || false
                    const configKey = test.id as keyof typeof daemonStressConfigs

                    return (
                      <div key={test.id} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <test.icon className="h-4 w-4 text-slate-600" />
                            <span className="text-sm font-medium">{test.name}</span>
                          </div>
                          {isRunning && test.status && (
                            <Badge className="bg-green-100 text-green-700 text-xs">
                              {formatTime(test.status.remainingTimeMs)}
                            </Badge>
                          )}
                        </div>

                        {!isRunning && (
                          <div className="mb-2">
                            <label className="text-xs text-slate-500">Duration (sec)</label>
                            <input
                              type="number"
                              value={daemonStressConfigs[configKey].durationMs}
                              onChange={(e) => setDaemonStressConfigs(prev => ({
                                ...prev,
                                [configKey]: { ...prev[configKey], durationMs: parseInt(e.target.value) || 300 }
                              }))}
                              className="w-full px-2 py-1 text-sm border rounded"
                              min={10}
                            />
                          </div>
                        )}

                        <Button
                          variant={isRunning ? "destructive" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => handleDaemonStressAction(test.id as any, isRunning ? 'stop' : 'start')}
                          disabled={loading?.startsWith('daemon_')}
                        >
                          {loading === `daemon_${test.id}_${isRunning ? 'stop' : 'start'}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : isRunning ? (
                            <><Square className="h-3 w-3 mr-1" /> Stop</>
                          ) : (
                            <><Play className="h-3 w-3 mr-1" /> Start</>
                          )}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!isDaemonConnected && device.ipAddress && (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
                <Server className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                <p className="text-sm text-slate-600 mb-2">Connect to daemon for advanced stress tests</p>
                <Button variant="outline" size="sm" onClick={connectToDaemon} disabled={isDaemonConnecting}>
                  {isDaemonConnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Connect Daemon
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Config Tab */}
          <TabsContent value="config" className="space-y-4 mt-4">
            {!isDaemonConnected ? (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
                <Settings className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                <p className="text-sm text-slate-600 mb-2">
                  {device.ipAddress ? 'Connect to daemon to manage module config' : 'Device IP not available'}
                </p>
                {device.ipAddress && (
                  <Button variant="outline" size="sm" onClick={connectToDaemon} disabled={isDaemonConnecting}>
                    {isDaemonConnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Connect Daemon
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* Save status */}
                <div className="flex items-center justify-end gap-2 text-sm">
                  {saveStatus === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</>}
                  {saveStatus === 'saved' && <><CheckCircle2 className="h-3 w-3 text-green-600" /> Saved</>}
                  {saveStatus === 'error' && <><XCircle className="h-3 w-3 text-red-600" /> Failed</>}
                </div>

                {/* Whitelist */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <Package className="h-4 w-4 text-slate-600" />
                      <span className="font-medium text-sm">Monitored Apps ({config.whitelist.length})</span>
                    </div>

                    {config.whitelist.length === 0 ? (
                      <p className="text-sm text-slate-500 text-center py-4">No apps in whitelist</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {config.whitelist.map((pkg) => {
                          const info = getPackageInfo(pkg)
                          return (
                            <div key={pkg} className="flex items-center justify-between p-2 bg-blue-50 rounded text-sm">
                              <div className="truncate flex-1 mr-2">
                                {info?.label && <div className="font-medium truncate">{info.label}</div>}
                                <div className="font-mono text-xs text-slate-500 truncate">{pkg}</div>
                              </div>
                              <Button variant="ghost" size="sm" onClick={() => handleRemoveFromWhitelist(pkg)} className="h-6 w-6 p-0 text-red-500">
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <form className="flex gap-2 mt-3" onSubmit={(e) => {
                      e.preventDefault()
                      const input = e.currentTarget.elements.namedItem('pkg') as HTMLInputElement
                      if (input.value.trim()) {
                        handleAddToWhitelist(input.value.trim())
                        input.value = ''
                      }
                    }}>
                      <input name="pkg" placeholder="com.example.app" className="flex-1 px-2 py-1 text-sm border rounded font-mono" />
                      <Button type="submit" size="sm"><Plus className="h-3 w-3" /></Button>
                    </form>
                  </div>

                  <div className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Search className="h-4 w-4 text-slate-600" />
                        <span className="font-medium text-sm">Available Packages</span>
                      </div>
                      <Button variant="ghost" size="sm" onClick={fetchPackages} disabled={packagesLoading}>
                        <RefreshCw className={`h-3 w-3 ${packagesLoading ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>

                    <input
                      type="text"
                      value={packageSearch}
                      onChange={(e) => setPackageSearch(e.target.value)}
                      placeholder="Search..."
                      className="w-full px-2 py-1 text-sm border rounded mb-2"
                    />

                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {filteredPackages.slice(0, 50).map((pkg) => (
                        <div key={pkg.package} className="flex items-center justify-between p-2 border rounded text-sm hover:bg-slate-50">
                          <div className="truncate flex-1 mr-2">
                            {pkg.label && <div className="font-medium truncate">{pkg.label}</div>}
                            <div className="font-mono text-xs text-slate-500 truncate">{pkg.package}</div>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => handleAddToWhitelist(pkg.package)} className="h-6 w-6 p-0">
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Settings */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Server className="h-4 w-4 text-slate-600" />
                      <span className="font-medium text-sm">Backend Settings</span>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Backend URL</label>
                      <input
                        type="text"
                        value={config.danrConfig.backendUrl}
                        onChange={(e) => handleDanrConfigChange('backendUrl', e.target.value)}
                        className="w-full px-2 py-1 text-sm border rounded"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">ANR Threshold (ms)</label>
                      <input
                        type="number"
                        value={config.danrConfig.anrThresholdMs}
                        onChange={(e) => handleDanrConfigChange('anrThresholdMs', parseInt(e.target.value) || 5000)}
                        className="w-full px-2 py-1 text-sm border rounded"
                      />
                    </div>
                  </div>

                  <div className="p-4 border rounded-lg space-y-2">
                    <div className="flex items-center gap-2 mb-2">
                      <Settings className="h-4 w-4 text-slate-600" />
                      <span className="font-medium text-sm">Monitoring</span>
                    </div>
                    {[
                      { key: 'enableInRelease', label: 'Enable in Release builds' },
                      { key: 'enableInDebug', label: 'Enable in Debug builds' },
                      { key: 'autoStart', label: 'Auto-start monitoring' },
                    ].map((item) => (
                      <label key={item.key} className="flex items-center justify-between p-2 bg-slate-50 rounded cursor-pointer hover:bg-slate-100">
                        <span className="text-sm">{item.label}</span>
                        <input
                          type="checkbox"
                          checked={config.danrConfig[item.key as keyof DanrConfig] as boolean}
                          onChange={(e) => handleDanrConfigChange(item.key as keyof DanrConfig, e.target.checked)}
                          className="rounded"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs" className="mt-4">
            {!isDaemonConnected ? (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
                <FileText className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                <p className="text-sm text-slate-600 mb-2">Connect to daemon to view logs</p>
                {device.ipAddress && (
                  <Button variant="outline" size="sm" onClick={connectToDaemon} disabled={isDaemonConnecting}>
                    Connect Daemon
                  </Button>
                )}
              </div>
            ) : (
              <div>
                <div className="flex justify-end mb-2">
                  <Button variant="outline" size="sm" onClick={fetchLogs} disabled={logsLoading}>
                    <RefreshCw className={`h-3 w-3 mr-1 ${logsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                {logsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                  </div>
                ) : logs ? (
                  <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto text-xs font-mono max-h-80 overflow-y-auto">
                    {logs}
                  </pre>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No logs available</p>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

// Main Page Component
export default function DevicesPage() {
  const { devices, isConnected } = useDevices()

  return (
    <div className="container mx-auto px-4 py-8 lg:px-8 max-w-7xl">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Device Control</h1>
            <p className="text-slate-600 mt-1">Remote control, stress testing, and module configuration</p>
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
        <div className="space-y-6">
          {devices.map((device) => (
            <DeviceControlPanel key={device.id} device={device} />
          ))}
        </div>
      )}
    </div>
  )
}
