'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useDevices } from '@/hooks/useDevices'
import { useDaemonConnection, autoConnectDaemon } from '@/hooks/useDaemonStore'
import { socketService, Device } from '@/lib/socket'
import { stressApi, ModuleConfig, DanrConfig, PackageInfo } from '@/lib/stressApi'
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

const AUTO_RESTORE_OPTIONS = [
  { label: 'Never', value: 0 },
  { label: '1 min', value: 60000 },
  { label: '5 min', value: 300000 },
  { label: '10 min', value: 600000 },
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
  const [stressSubTab, setStressSubTab] = useState('sdk') // Will be set to 'daemon' when daemon connects
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // CPU state
  const [selectedFreq, setSelectedFreq] = useState<number | null>(null)
  const [autoRestoreMs, setAutoRestoreMs] = useState(0)

  // SDK Stress state
  const [sdkStressStatuses, setSdkStressStatuses] = useState<Record<string, { isRunning: boolean; remainingTimeMs: number }>>({})
  const [sdkStressConfigs, setSdkStressConfigs] = useState({
    cpu: { threadCount: 4, loadPercentage: 100 },
    memory: { targetMemoryMB: 100 },
    disk_io: { throughputMBps: 5 },
  })

  // Daemon connection from global store
  const daemon = useDaemonConnection(device.id)
  const isDaemonConnected = daemon.isConnected
  const isDaemonConnecting = daemon.isConnecting
  const daemonUrl = daemon.url
  const daemonStressStatus = daemon.stressStatus
  const cpuFreqStatus = daemon.cpuFreqStatus
  const [manualDaemonUrl, setManualDaemonUrl] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)

  // Daemon stress configs (local UI state)
  const [daemonStressConfigs, setDaemonStressConfigs] = useState({
    cpu: { threadCount: 4, loadPercentage: 100, durationMs: 300 },
    memory: { targetFreeMB: 100, durationMs: 300 },
    disk: { throughputMBps: 5, durationMs: 300 },
    network: { bandwidthLimitKbps: 1000, latencyMs: 100, packetLossPercent: 0, durationMs: 300 },
    thermal: { maxFrequencyPercent: 100, forceAllCoresOnline: true, durationMs: 300 },
  })

  // Module config from daemon store
  const storeConfig = daemon.config || defaultConfig
  const packages = daemon.packages
  const [packagesLoading, setPackagesLoading] = useState(false)
  const [packageSearch, setPackageSearch] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // Local config state for form inputs (prevents input lag during saves)
  const [localConfig, setLocalConfig] = useState<ModuleConfig>(storeConfig)
  const isEditingRef = useRef(false)

  // Logs state
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)

  // Auto-save ref
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const editingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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

  // Initialize manual URL with device IP if available
  useEffect(() => {
    if (device.ipAddress && !manualDaemonUrl) {
      setManualDaemonUrl(`http://${device.ipAddress}:8765`)
    }
  }, [device.ipAddress, manualDaemonUrl])

  // Switch to daemon stress tab when daemon connects
  useEffect(() => {
    if (isDaemonConnected) {
      setStressSubTab('daemon')
    }
  }, [isDaemonConnected])

  // Auto-connect to daemon (tries persisted URL first, then device IP)
  useEffect(() => {
    autoConnectDaemon(device.id, device.ipAddress)
  }, [device.id, device.ipAddress])

  // Cleanup auto-save timeout
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      if (editingTimeoutRef.current) {
        clearTimeout(editingTimeoutRef.current)
      }
    }
  }, [])

  // Sync local config from store when not editing
  useEffect(() => {
    if (!isEditingRef.current) {
      setLocalConfig(storeConfig)
    }
  }, [storeConfig])

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

  const connectToDaemon = async (customUrl?: string) => {
    const targetUrl = customUrl || (device.ipAddress ? `http://${device.ipAddress}:8765` : null)
    if (!targetUrl) return

    const success = await daemon.connect(targetUrl)
    if (success) {
      setShowManualInput(false)
    } else {
      showMessage('Failed to connect to daemon', 'error')
    }
  }

  const disconnectDaemon = () => {
    daemon.disconnect()
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
            await stressApi.startCpu({ ...(cfg as (typeof daemonStressConfigs)['cpu']), durationMs })
            break
          case 'memory':
            await stressApi.startMemory({ ...(cfg as (typeof daemonStressConfigs)['memory']), durationMs })
            break
          case 'disk':
            await stressApi.startDisk({ ...(cfg as (typeof daemonStressConfigs)['disk']), durationMs })
            break
          case 'network':
            await stressApi.startNetwork({ ...(cfg as (typeof daemonStressConfigs)['network']), durationMs })
            break
          case 'thermal':
            await stressApi.startThermal({ ...(cfg as (typeof daemonStressConfigs)['thermal']), durationMs })
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
  const saveConfigToStore = useCallback(async (configToSave: ModuleConfig) => {
    if (!isDaemonConnected) return

    setSaveStatus('saving')
    const success = await daemon.saveConfig(configToSave)
    if (success) {
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } else {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [isDaemonConnected, daemon])

  const triggerAutoSave = useCallback((newConfig: ModuleConfig) => {
    // Mark as editing
    isEditingRef.current = true

    // Clear existing timeouts
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    if (editingTimeoutRef.current) {
      clearTimeout(editingTimeoutRef.current)
    }

    // Debounced save (1.5s after last keystroke)
    saveTimeoutRef.current = setTimeout(() => {
      saveConfigToStore(newConfig)
    }, 1500)

    // Clear editing flag after user stops typing (2s)
    editingTimeoutRef.current = setTimeout(() => {
      isEditingRef.current = false
    }, 2000)
  }, [saveConfigToStore])

  const handleAddToWhitelist = (packageName: string) => {
    if (!localConfig.whitelist.includes(packageName)) {
      const newConfig = { ...localConfig, whitelist: [...localConfig.whitelist, packageName] }
      setLocalConfig(newConfig)
      triggerAutoSave(newConfig)
    }
  }

  const handleRemoveFromWhitelist = (packageName: string) => {
    const newConfig = { ...localConfig, whitelist: localConfig.whitelist.filter(p => p !== packageName) }
    setLocalConfig(newConfig)
    triggerAutoSave(newConfig)
  }

  const handleDanrConfigChange = (key: keyof DanrConfig, value: string | number | boolean) => {
    const newConfig = { ...localConfig, danrConfig: { ...localConfig.danrConfig, [key]: value } }
    setLocalConfig(newConfig)
    triggerAutoSave(newConfig)
  }

  // Packages
  const fetchPackages = async () => {
    if (!isDaemonConnected) return
    setPackagesLoading(true)
    await daemon.refreshPackages()
    setPackagesLoading(false)
  }

  const filteredPackages = packages.filter(pkg => {
    const searchLower = packageSearch.toLowerCase()
    const isNotInWhitelist = !localConfig.whitelist.includes(pkg.package)
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
    const logText = await daemon.fetchLogs()
    setLogs(logText)
    setLogsLoading(false)
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
              <div className="flex items-center gap-2">
                <Badge className="bg-green-100 text-green-700 border-green-200">
                  <Server className="h-3 w-3 mr-1" />
                  Daemon
                </Badge>
                <Button variant="ghost" size="sm" onClick={disconnectDaemon} className="h-6 px-2 text-xs text-slate-500">
                  Disconnect
                </Button>
              </div>
            ) : isDaemonConnecting ? (
              <Badge variant="outline" className="text-slate-500">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Connecting...
              </Badge>
            ) : (
              <div className="flex items-center gap-1">
                {device.ipAddress && (
                  <Button variant="outline" size="sm" onClick={() => connectToDaemon()}>
                    Auto Connect
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowManualInput(!showManualInput)}
                  className="text-xs"
                >
                  {showManualInput ? 'Cancel' : 'Manual'}
                </Button>
              </div>
            )}
            <div className="flex items-center gap-2 px-2 py-1 bg-green-50 rounded-full border border-green-200">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs text-green-700 font-medium">Connected</span>
            </div>
          </div>
        </div>

        {/* Manual daemon URL input */}
        {showManualInput && !isDaemonConnected && (
          <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <label className="text-xs text-slate-500 mb-1 block">Daemon URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualDaemonUrl}
                onChange={(e) => setManualDaemonUrl(e.target.value)}
                placeholder="http://192.168.1.100:8765"
                className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button
                size="sm"
                onClick={() => connectToDaemon(manualDaemonUrl)}
                disabled={!manualDaemonUrl || isDaemonConnecting}
              >
                {isDaemonConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
              </Button>
            </div>
          </div>
        )}

        {/* Connected daemon URL display */}
        {isDaemonConnected && daemonUrl && (
          <div className="mt-2 text-xs text-slate-500">
            <Server className="h-3 w-3 inline mr-1" />
            {daemonUrl}
          </div>
        )}

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
            {isDaemonConnected && cpuFreqStatus ? (
              <>
                {/* Current Status */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="text-xs text-slate-500 mb-1">Original Max</div>
                    <div className="text-sm font-semibold text-slate-900">
                      {formatFrequency(cpuFreqStatus.originalMaxFreq)}
                    </div>
                  </div>
                  <div className={`p-4 rounded-lg border ${cpuFreqStatus.isLimited ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className={`text-xs mb-1 ${cpuFreqStatus.isLimited ? 'text-blue-600' : 'text-slate-500'}`}>Target Max</div>
                    <div className={`text-sm font-semibold ${cpuFreqStatus.isLimited ? 'text-blue-700' : 'text-slate-900'}`}>
                      {cpuFreqStatus.isLimited ? formatFrequency(cpuFreqStatus.targetMaxFreq) : 'Not limited'}
                    </div>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <div className="text-xs text-green-600 mb-1">Actual Max</div>
                    <div className="text-sm font-semibold text-green-700">
                      {formatFrequency(cpuFreqStatus.actualMaxFreq)}
                    </div>
                  </div>
                </div>

                {/* Auto-restore countdown */}
                {cpuFreqStatus.isLimited && cpuFreqStatus.remainingRestoreMs > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-lg border border-amber-200">
                    <Clock className="h-4 w-4 text-amber-600" />
                    <span className="text-sm text-amber-700">
                      Auto-restore in {formatTime(cpuFreqStatus.remainingRestoreMs)}
                    </span>
                  </div>
                )}

                {/* Quick Presets */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Quick Presets</h3>
                  <div className="grid grid-cols-4 gap-2">
                    {CPU_PRESETS.map((preset) => {
                      const targetFreq = Math.floor(cpuFreqStatus.originalMaxFreq * (preset.percentage / 100))
                      const isActive = cpuFreqStatus.isLimited && cpuFreqStatus.targetMaxFreq === targetFreq
                      return (
                        <Button
                          key={preset.name}
                          variant={isActive ? "default" : "outline"}
                          size="sm"
                          onClick={async () => {
                            setLoading('cpu_preset')
                            try {
                              await stressApi.setCpuFrequency({ frequency: targetFreq, autoRestoreMs })
                              showMessage(`CPU frequency set to ${preset.name}`, 'success')
                            } catch { showMessage('Failed to set frequency', 'error') }
                            finally { setLoading(null) }
                          }}
                          disabled={loading === 'cpu_preset'}
                          className="w-full h-12"
                        >
                          {loading === 'cpu_preset' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <span className="font-semibold">{preset.name}</span>
                          )}
                        </Button>
                      )
                    })}
                  </div>
                </div>

                {/* Custom Frequency */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Custom Frequency</h3>
                  <div className="flex gap-2">
                    <select
                      value={selectedFreq || ''}
                      onChange={(e) => setSelectedFreq(Number(e.target.value))}
                      className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select frequency...</option>
                      {cpuFreqStatus.availableFreqs.map((freq) => (
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
                          await stressApi.setCpuFrequency({ frequency: selectedFreq, autoRestoreMs })
                          showMessage(`CPU frequency set`, 'success')
                        } catch { showMessage('Failed to set frequency', 'error') }
                        finally { setLoading(null) }
                      }}
                      disabled={!selectedFreq || loading === 'custom_freq'}
                      className="px-6"
                    >
                      {loading === 'custom_freq' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                    </Button>
                  </div>
                </div>

                {/* Auto-restore timeout setting */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Auto-Restore Timeout</h3>
                  <div className="flex gap-2">
                    {AUTO_RESTORE_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        variant={autoRestoreMs === option.value ? "default" : "outline"}
                        size="sm"
                        onClick={() => setAutoRestoreMs(option.value)}
                        className="flex-1"
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    {autoRestoreMs === 0 ? 'Frequency will stay limited until manually restored' : `Frequency will auto-restore after ${autoRestoreMs / 60000} minute(s)`}
                  </p>
                </div>

                {/* Restore button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setLoading('restore')
                    try {
                      await stressApi.restoreCpuFrequency()
                      showMessage('CPU frequency restored', 'success')
                    } catch { showMessage('Failed to restore frequency', 'error') }
                    finally { setLoading(null) }
                  }}
                  disabled={!cpuFreqStatus.isLimited || loading === 'restore'}
                  className="w-full border-orange-200 text-orange-600 hover:bg-orange-50"
                >
                  {loading === 'restore' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Restore Original Frequency
                </Button>
              </>
            ) : (
              <>
                {/* SDK-based CPU Control (fallback) */}
                {!isDaemonConnected && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
                    <Info className="h-4 w-4 text-slate-500" />
                    <span className="text-sm text-slate-600">Connect to daemon for more reliable CPU control with auto re-apply</span>
                  </div>
                )}

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
          <TabsContent value="stress" className="space-y-4 mt-4">
            <Tabs value={stressSubTab} onValueChange={setStressSubTab}>
              <TabsList className="w-full">
                <TabsTrigger value="daemon" className="flex-1">
                  <Server className="h-4 w-4 mr-1.5" />
                  Daemon {activeDaemonStressCount > 0 && `(${activeDaemonStressCount})`}
                  {isDaemonConnected && <span className="ml-1.5 w-2 h-2 bg-green-500 rounded-full" />}
                </TabsTrigger>
                <TabsTrigger value="sdk" className="flex-1">
                  <Smartphone className="h-4 w-4 mr-1.5" />
                  SDK {activeSdkStressCount > 0 && `(${activeSdkStressCount})`}
                </TabsTrigger>
              </TabsList>

              {/* SDK Stress Tab */}
              <TabsContent value="sdk" className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-600">SDK-based stress tests run for 5 minutes</p>
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
                      Stop All
                    </Button>
                  )}
                </div>

                <div className="space-y-3">
                {/* SDK CPU Stress */}
                {(() => {
                  const status = sdkStressStatuses['cpu']
                  const isRunning = status?.isRunning || false
                  return (
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Cpu className="h-5 w-5 text-slate-600" />
                          <span className="font-medium">CPU Stress</span>
                        </div>
                        {isRunning && (
                          <Badge className="bg-green-100 text-green-700">
                            {formatTime(status.remainingTimeMs)}
                          </Badge>
                        )}
                      </div>
                      {!isRunning && (
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">Threads</label>
                            <select
                              value={sdkStressConfigs.cpu.threadCount}
                              onChange={(e) => setSdkStressConfigs(prev => ({
                                ...prev,
                                cpu: { ...prev.cpu, threadCount: Number(e.target.value) }
                              }))}
                              className="w-full px-2 py-1.5 text-sm border rounded"
                            >
                              {[1, 2, 4, 6, 8].map(n => <option key={n} value={n}>{n} threads</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">Load</label>
                            <select
                              value={sdkStressConfigs.cpu.loadPercentage}
                              onChange={(e) => setSdkStressConfigs(prev => ({
                                ...prev,
                                cpu: { ...prev.cpu, loadPercentage: Number(e.target.value) }
                              }))}
                              className="w-full px-2 py-1.5 text-sm border rounded"
                            >
                              {[25, 50, 75, 100].map(n => <option key={n} value={n}>{n}%</option>)}
                            </select>
                          </div>
                        </div>
                      )}
                      <Button
                        variant={isRunning ? "destructive" : "outline"}
                        size="sm"
                        className="w-full"
                        onClick={() => isRunning ? handleStopSdkStress('cpu') : handleStartSdkStress('cpu')}
                        disabled={loading?.startsWith('sdk_stress')}
                      >
                        {loading === `sdk_stress_${isRunning ? 'stop' : 'start'}_cpu` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isRunning ? (
                          <><Square className="h-3 w-3 mr-1" /> Stop</>
                        ) : (
                          <><Play className="h-3 w-3 mr-1" /> Start</>
                        )}
                      </Button>
                    </div>
                  )
                })()}

                {/* SDK Memory Stress */}
                {(() => {
                  const status = sdkStressStatuses['memory']
                  const isRunning = status?.isRunning || false
                  return (
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <MemoryStick className="h-5 w-5 text-slate-600" />
                          <span className="font-medium">Memory Pressure</span>
                        </div>
                        {isRunning && (
                          <Badge className="bg-green-100 text-green-700">
                            {formatTime(status.remainingTimeMs)}
                          </Badge>
                        )}
                      </div>
                      {!isRunning && (
                        <div className="mb-3">
                          <label className="text-xs text-slate-500 block mb-1">Target Free Memory MB (lower = more pressure)</label>
                          <input
                            type="number"
                            min={10}
                            max={2000}
                            value={sdkStressConfigs.memory.targetMemoryMB}
                            onChange={(e) => setSdkStressConfigs(prev => ({
                              ...prev,
                              memory: { targetMemoryMB: Number(e.target.value) || 100 }
                            }))}
                            className="w-full px-2 py-1.5 text-sm border rounded"
                          />
                        </div>
                      )}
                      <Button
                        variant={isRunning ? "destructive" : "outline"}
                        size="sm"
                        className="w-full"
                        onClick={() => isRunning ? handleStopSdkStress('memory') : handleStartSdkStress('memory')}
                        disabled={loading?.startsWith('sdk_stress')}
                      >
                        {loading === `sdk_stress_${isRunning ? 'stop' : 'start'}_memory` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isRunning ? (
                          <><Square className="h-3 w-3 mr-1" /> Stop</>
                        ) : (
                          <><Play className="h-3 w-3 mr-1" /> Start</>
                        )}
                      </Button>
                    </div>
                  )
                })()}

                {/* SDK Disk I/O Stress */}
                {(() => {
                  const status = sdkStressStatuses['disk_io']
                  const isRunning = status?.isRunning || false
                  return (
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <HardDrive className="h-5 w-5 text-slate-600" />
                          <span className="font-medium">Disk I/O</span>
                        </div>
                        {isRunning && (
                          <Badge className="bg-green-100 text-green-700">
                            {formatTime(status.remainingTimeMs)}
                          </Badge>
                        )}
                      </div>
                      {!isRunning && (
                        <div className="mb-3">
                          <label className="text-xs text-slate-500 block mb-1">Throughput</label>
                          <select
                            value={sdkStressConfigs.disk_io.throughputMBps}
                            onChange={(e) => setSdkStressConfigs(prev => ({
                              ...prev,
                              disk_io: { throughputMBps: Number(e.target.value) }
                            }))}
                            className="w-full px-2 py-1.5 text-sm border rounded"
                          >
                            {[1, 5, 10, 20].map(n => <option key={n} value={n}>{n} MB/s</option>)}
                          </select>
                        </div>
                      )}
                      <Button
                        variant={isRunning ? "destructive" : "outline"}
                        size="sm"
                        className="w-full"
                        onClick={() => isRunning ? handleStopSdkStress('disk_io') : handleStartSdkStress('disk_io')}
                        disabled={loading?.startsWith('sdk_stress')}
                      >
                        {loading === `sdk_stress_${isRunning ? 'stop' : 'start'}_disk_io` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isRunning ? (
                          <><Square className="h-3 w-3 mr-1" /> Stop</>
                        ) : (
                          <><Play className="h-3 w-3 mr-1" /> Start</>
                        )}
                      </Button>
                    </div>
                  )
                })()}
                </div>
              </TabsContent>

              {/* Daemon Stress Tab */}
              <TabsContent value="daemon" className="space-y-4 mt-4">
                {!isDaemonConnected ? (
                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
                    <Server className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                    <p className="text-sm text-slate-600 mb-2">Connect to daemon for advanced stress tests</p>
                    <div className="flex flex-col items-center gap-2">
                      {device.ipAddress && (
                        <Button variant="outline" size="sm" onClick={() => connectToDaemon()} disabled={isDaemonConnecting}>
                          {isDaemonConnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Auto Connect
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setShowManualInput(true)} className="text-xs">
                        Enter URL manually
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-slate-600">Advanced daemon-based stress tests with configurable duration</p>
                      {activeDaemonStressCount > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleStopAllDaemonStress}
                          disabled={loading === 'daemon_stop_all'}
                          className="text-xs border-orange-200 text-orange-600 hover:bg-orange-50"
                        >
                          Stop All
                        </Button>
                      )}
                    </div>

                    <div className="space-y-3">
                  {/* Daemon CPU Stress */}
                  {(() => {
                    const isRunning = daemonStressStatus?.cpu?.isRunning || false
                    return (
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Cpu className="h-5 w-5 text-slate-600" />
                            <span className="font-medium">CPU Stress</span>
                          </div>
                          {isRunning && daemonStressStatus?.cpu && (
                            <Badge className="bg-green-100 text-green-700">
                              {formatTime(daemonStressStatus.cpu.remainingTimeMs)}
                            </Badge>
                          )}
                        </div>
                        {!isRunning && (
                          <div className="grid grid-cols-3 gap-2 mb-3">
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Threads</label>
                              <select
                                value={daemonStressConfigs.cpu.threadCount}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  cpu: { ...prev.cpu, threadCount: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                {[1, 2, 4, 6, 8].map(n => <option key={n} value={n}>{n}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Load %</label>
                              <select
                                value={daemonStressConfigs.cpu.loadPercentage}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  cpu: { ...prev.cpu, loadPercentage: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                {[25, 50, 75, 100].map(n => <option key={n} value={n}>{n}%</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Duration</label>
                              <select
                                value={daemonStressConfigs.cpu.durationMs}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  cpu: { ...prev.cpu, durationMs: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                {[60, 120, 300, 600].map(n => <option key={n} value={n}>{n}s</option>)}
                              </select>
                            </div>
                          </div>
                        )}
                        <Button
                          variant={isRunning ? "destructive" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => handleDaemonStressAction('cpu', isRunning ? 'stop' : 'start')}
                          disabled={loading?.startsWith('daemon_')}
                        >
                          {loading === `daemon_cpu_${isRunning ? 'stop' : 'start'}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : isRunning ? (
                            <><Square className="h-3 w-3 mr-1" /> Stop</>
                          ) : (
                            <><Play className="h-3 w-3 mr-1" /> Start</>
                          )}
                        </Button>
                      </div>
                    )
                  })()}

                  {/* Daemon Memory Stress */}
                  {(() => {
                    const isRunning = daemonStressStatus?.memory?.isRunning || false
                    return (
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <MemoryStick className="h-5 w-5 text-slate-600" />
                            <span className="font-medium">Memory Pressure</span>
                          </div>
                          {isRunning && daemonStressStatus?.memory && (
                            <Badge className="bg-green-100 text-green-700">
                              {formatTime(daemonStressStatus.memory.remainingTimeMs)}
                            </Badge>
                          )}
                        </div>
                        {!isRunning && (
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Target Free MB</label>
                              <input
                                type="number"
                                min={10}
                                max={2000}
                                value={daemonStressConfigs.memory.targetFreeMB}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  memory: { ...prev.memory, targetFreeMB: Number(e.target.value) || 100 }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Duration</label>
                              <select
                                value={daemonStressConfigs.memory.durationMs}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  memory: { ...prev.memory, durationMs: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                {[60, 120, 300, 600].map(n => <option key={n} value={n}>{n}s</option>)}
                              </select>
                            </div>
                          </div>
                        )}
                        <Button
                          variant={isRunning ? "destructive" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => handleDaemonStressAction('memory', isRunning ? 'stop' : 'start')}
                          disabled={loading?.startsWith('daemon_')}
                        >
                          {loading === `daemon_memory_${isRunning ? 'stop' : 'start'}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : isRunning ? (
                            <><Square className="h-3 w-3 mr-1" /> Stop</>
                          ) : (
                            <><Play className="h-3 w-3 mr-1" /> Start</>
                          )}
                        </Button>
                      </div>
                    )
                  })()}

                  {/* Daemon Disk Stress */}
                  {(() => {
                    const isRunning = daemonStressStatus?.disk_io?.isRunning || false
                    return (
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <HardDrive className="h-5 w-5 text-slate-600" />
                            <span className="font-medium">Disk I/O</span>
                          </div>
                          {isRunning && daemonStressStatus?.disk_io && (
                            <Badge className="bg-green-100 text-green-700">
                              {formatTime(daemonStressStatus.disk_io.remainingTimeMs)}
                            </Badge>
                          )}
                        </div>
                        {!isRunning && (
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Throughput</label>
                              <select
                                value={daemonStressConfigs.disk.throughputMBps}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  disk: { ...prev.disk, throughputMBps: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                {[1, 5, 10, 20, 50].map(n => <option key={n} value={n}>{n} MB/s</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Duration</label>
                              <select
                                value={daemonStressConfigs.disk.durationMs}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  disk: { ...prev.disk, durationMs: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                {[60, 120, 300, 600].map(n => <option key={n} value={n}>{n}s</option>)}
                              </select>
                            </div>
                          </div>
                        )}
                        <Button
                          variant={isRunning ? "destructive" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => handleDaemonStressAction('disk', isRunning ? 'stop' : 'start')}
                          disabled={loading?.startsWith('daemon_')}
                        >
                          {loading === `daemon_disk_${isRunning ? 'stop' : 'start'}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : isRunning ? (
                            <><Square className="h-3 w-3 mr-1" /> Stop</>
                          ) : (
                            <><Play className="h-3 w-3 mr-1" /> Start</>
                          )}
                        </Button>
                      </div>
                    )
                  })()}

                  {/* Daemon Network Stress */}
                  {(() => {
                    const isRunning = daemonStressStatus?.network?.isRunning || false
                    return (
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Wifi className="h-5 w-5 text-slate-600" />
                            <span className="font-medium">Network Shaping</span>
                          </div>
                          {isRunning && daemonStressStatus?.network && (
                            <Badge className="bg-green-100 text-green-700">
                              {formatTime(daemonStressStatus.network.remainingTimeMs)}
                            </Badge>
                          )}
                        </div>
                        {!isRunning && (
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Bandwidth Limit</label>
                              <select
                                value={daemonStressConfigs.network.bandwidthLimitKbps}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  network: { ...prev.network, bandwidthLimitKbps: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                <option value={0}>Unlimited</option>
                                {[128, 256, 512, 1024, 2048].map(n => <option key={n} value={n}>{n} kbps</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Latency</label>
                              <select
                                value={daemonStressConfigs.network.latencyMs}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  network: { ...prev.network, latencyMs: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                {[0, 50, 100, 200, 500, 1000].map(n => <option key={n} value={n}>{n} ms</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Packet Loss</label>
                              <select
                                value={daemonStressConfigs.network.packetLossPercent}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  network: { ...prev.network, packetLossPercent: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                {[0, 1, 5, 10, 25, 50].map(n => <option key={n} value={n}>{n}%</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Duration</label>
                              <select
                                value={daemonStressConfigs.network.durationMs}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  network: { ...prev.network, durationMs: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                {[60, 120, 300, 600].map(n => <option key={n} value={n}>{n}s</option>)}
                              </select>
                            </div>
                          </div>
                        )}
                        <Button
                          variant={isRunning ? "destructive" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => handleDaemonStressAction('network', isRunning ? 'stop' : 'start')}
                          disabled={loading?.startsWith('daemon_')}
                        >
                          {loading === `daemon_network_${isRunning ? 'stop' : 'start'}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : isRunning ? (
                            <><Square className="h-3 w-3 mr-1" /> Stop</>
                          ) : (
                            <><Play className="h-3 w-3 mr-1" /> Start</>
                          )}
                        </Button>
                      </div>
                    )
                  })()}

                  {/* Daemon Thermal Stress */}
                  {(() => {
                    const isRunning = daemonStressStatus?.thermal?.isRunning || false
                    return (
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Thermometer className="h-5 w-5 text-slate-600" />
                            <span className="font-medium">Thermal Control</span>
                          </div>
                          {isRunning && daemonStressStatus?.thermal && (
                            <Badge className="bg-green-100 text-green-700">
                              {formatTime(daemonStressStatus.thermal.remainingTimeMs)}
                            </Badge>
                          )}
                        </div>
                        {!isRunning && (
                          <div className="grid grid-cols-3 gap-2 mb-3">
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Max Freq %</label>
                              <select
                                value={daemonStressConfigs.thermal.maxFrequencyPercent}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  thermal: { ...prev.thermal, maxFrequencyPercent: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                {[25, 50, 75, 100].map(n => <option key={n} value={n}>{n}%</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">All Cores</label>
                              <select
                                value={daemonStressConfigs.thermal.forceAllCoresOnline ? 'yes' : 'no'}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  thermal: { ...prev.thermal, forceAllCoresOnline: e.target.value === 'yes' }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                <option value="yes">Online</option>
                                <option value="no">Default</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Duration</label>
                              <select
                                value={daemonStressConfigs.thermal.durationMs}
                                onChange={(e) => setDaemonStressConfigs(prev => ({
                                  ...prev,
                                  thermal: { ...prev.thermal, durationMs: Number(e.target.value) }
                                }))}
                                className="w-full px-2 py-1 text-sm border rounded"
                              >
                                {[60, 120, 300, 600].map(n => <option key={n} value={n}>{n}s</option>)}
                              </select>
                            </div>
                          </div>
                        )}
                        <Button
                          variant={isRunning ? "destructive" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => handleDaemonStressAction('thermal', isRunning ? 'stop' : 'start')}
                          disabled={loading?.startsWith('daemon_')}
                        >
                          {loading === `daemon_thermal_${isRunning ? 'stop' : 'start'}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : isRunning ? (
                            <><Square className="h-3 w-3 mr-1" /> Stop</>
                          ) : (
                            <><Play className="h-3 w-3 mr-1" /> Start</>
                          )}
                        </Button>
                      </div>
                    )
                  })()}
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* Config Tab */}
          <TabsContent value="config" className="space-y-4 mt-4">
            {!isDaemonConnected ? (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
                <Settings className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                <p className="text-sm text-slate-600 mb-2">Connect to daemon to manage module config</p>
                <div className="flex flex-col items-center gap-2">
                  {device.ipAddress && (
                    <Button variant="outline" size="sm" onClick={() => connectToDaemon()} disabled={isDaemonConnecting}>
                      {isDaemonConnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Auto Connect
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setShowManualInput(true)} className="text-xs">
                    Enter URL manually
                  </Button>
                </div>
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
                      <span className="font-medium text-sm">Monitored Apps ({localConfig.whitelist.length})</span>
                    </div>

                    {localConfig.whitelist.length === 0 ? (
                      <p className="text-sm text-slate-500 text-center py-4">No apps in whitelist</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {localConfig.whitelist.map((pkg) => {
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
                        value={localConfig.danrConfig.backendUrl}
                        onChange={(e) => handleDanrConfigChange('backendUrl', e.target.value)}
                        className="w-full px-2 py-1 text-sm border rounded"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">ANR Threshold (ms)</label>
                      <input
                        type="number"
                        value={localConfig.danrConfig.anrThresholdMs}
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
                          checked={localConfig.danrConfig[item.key as keyof DanrConfig] as boolean}
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
                <div className="flex flex-col items-center gap-2">
                  {device.ipAddress && (
                    <Button variant="outline" size="sm" onClick={() => connectToDaemon()} disabled={isDaemonConnecting}>
                      {isDaemonConnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Auto Connect
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setShowManualInput(true)} className="text-xs">
                    Enter URL manually
                  </Button>
                </div>
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

// Standalone Daemon Connection Panel - for connecting without a device
// Uses the same daemon store as SDK devices for persistence
const STANDALONE_DEVICE_ID = 'standalone-daemon'

interface StandaloneDaemonPanelProps {
  onConnectionChange: (connected: boolean) => void
}

function StandaloneDaemonPanel({ onConnectionChange }: StandaloneDaemonPanelProps) {
  const [manualUrl, setManualUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Use the same daemon store for persistence
  const daemon = useDaemonConnection(STANDALONE_DEVICE_ID)
  const isConnected = daemon.isConnected
  const isConnecting = daemon.isConnecting

  // Auto-connect on mount if we have a persisted URL
  useEffect(() => {
    autoConnectDaemon(STANDALONE_DEVICE_ID, undefined)
  }, [])

  // Notify parent of connection changes
  useEffect(() => {
    onConnectionChange(isConnected)
  }, [isConnected, onConnectionChange])

  const handleConnect = async () => {
    if (!manualUrl.trim()) return
    setError(null)

    const success = await daemon.connect(manualUrl.trim())
    if (!success) {
      setError('Failed to connect to daemon')
    }
  }

  if (isConnected) {
    // Create a mock device for the control panel
    const mockDevice: Device = {
      id: STANDALONE_DEVICE_ID,
      model: 'Standalone Daemon',
      androidVersion: 'N/A',
      hasRoot: true,
      connectedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      ipAddress: daemon.url.replace(/^https?:\/\//, '').replace(/:\d+$/, ''),
    }

    return <DeviceControlPanel device={mockDevice} />
  }

  return (
    <Card className="bg-white mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center shadow-sm">
            <Server className="h-5 w-5 text-white" />
          </div>
          <div>
            <CardTitle className="text-base">Manual Daemon Connection</CardTitle>
            <CardDescription className="text-sm">Connect directly to a daemon without SDK</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="http://192.168.1.100:8765"
            className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
          />
          <Button onClick={handleConnect} disabled={!manualUrl.trim() || isConnecting} className="bg-purple-600 hover:bg-purple-700">
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
          </Button>
        </div>
        {error && (
          <p className="text-sm text-red-600 mt-2">{error}</p>
        )}
      </CardContent>
    </Card>
  )
}

// Main Page Component
export default function DevicesPage() {
  const { devices, isConnected } = useDevices()
  const [hasStandaloneConnection, setHasStandaloneConnection] = useState(false)

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
        <>
          {/* Show manual connection only when no SDK devices */}
          <StandaloneDaemonPanel onConnectionChange={setHasStandaloneConnection} />

          {!hasStandaloneConnection && (
            <Card className="bg-white border-2 border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                  <Smartphone className="h-10 w-10 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">No SDK devices connected</h3>
                <p className="text-sm text-slate-500 text-center max-w-md">
                  Use the manual connection above to connect to a daemon, or connect an Android device with the DANR SDK installed.
                </p>
              </CardContent>
            </Card>
          )}
        </>
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
