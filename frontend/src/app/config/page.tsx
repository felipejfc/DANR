'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Settings,
  Smartphone,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Plus,
  X,
  Search,
  FileText,
  Package,
  Server
} from 'lucide-react'
import { stressApi, ModuleConfig, DanrConfig, PackageInfo } from '@/lib/stressApi'
import { socketService, Device } from '@/lib/socket'

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

export default function ConfigurationPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [deviceUrl, setDeviceUrl] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isDaemonConnecting, setIsDaemonConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Config state
  const [config, setConfig] = useState<ModuleConfig>(defaultConfig)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // Packages state
  const [packages, setPackages] = useState<PackageInfo[]>([])
  const [packagesLoading, setPackagesLoading] = useState(false)
  const [packageSearch, setPackageSearch] = useState('')

  // Logs state
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)

  // Tab state
  const [activeTab, setActiveTab] = useState('whitelist')

  // Auto-save debounce ref
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const configRef = useRef(config)

  // Keep configRef in sync
  useEffect(() => {
    configRef.current = config
  }, [config])

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

  // Auto-save function
  const autoSave = useCallback(async (configToSave: ModuleConfig) => {
    if (!isConnected) return

    setIsSaving(true)
    setSaveStatus('saving')

    try {
      await stressApi.saveConfig(configToSave)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config')
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } finally {
      setIsSaving(false)
    }
  }, [isConnected])

  // Trigger auto-save when config changes (debounced)
  const triggerAutoSave = useCallback((newConfig: ModuleConfig) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      autoSave(newConfig)
    }, 800)
  }, [autoSave])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const fetchConfig = useCallback(async () => {
    if (!isConnected) return

    setIsLoading(true)
    try {
      const newConfig = await stressApi.getConfig()
      setConfig(newConfig)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch config')
    } finally {
      setIsLoading(false)
    }
  }, [isConnected])

  const fetchPackages = useCallback(async () => {
    if (!isConnected) return

    setPackagesLoading(true)
    try {
      const pkgs = await stressApi.getPackages()
      setPackages(pkgs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch packages')
    } finally {
      setPackagesLoading(false)
    }
  }, [isConnected])

  const fetchLogs = useCallback(async () => {
    if (!isConnected) return

    setLogsLoading(true)
    try {
      const logText = await stressApi.getLogs()
      setLogs(logText)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs')
    } finally {
      setLogsLoading(false)
    }
  }, [isConnected])

  // Fetch config and packages when connected
  useEffect(() => {
    if (isConnected) {
      fetchConfig()
      fetchPackages()
    }
  }, [isConnected, fetchConfig, fetchPackages])

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
      const newConfig = await stressApi.getConfig()
      setConfig(newConfig)
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
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    setIsConnected(false)
    setConfig(defaultConfig)
    setPackages([])
    setLogs('')
  }

  const updateConfig = (newConfig: ModuleConfig) => {
    setConfig(newConfig)
    triggerAutoSave(newConfig)
  }

  const handleAddToWhitelist = (packageName: string) => {
    if (!config.whitelist.includes(packageName)) {
      const newConfig = {
        ...config,
        whitelist: [...config.whitelist, packageName]
      }
      updateConfig(newConfig)
    }
  }

  const handleRemoveFromWhitelist = (packageName: string) => {
    const newConfig = {
      ...config,
      whitelist: config.whitelist.filter(p => p !== packageName)
    }
    updateConfig(newConfig)
  }

  const handleDanrConfigChange = (key: keyof DanrConfig, value: string | number | boolean) => {
    const newConfig = {
      ...config,
      danrConfig: {
        ...config.danrConfig,
        [key]: value
      }
    }
    updateConfig(newConfig)
  }

  const filteredPackages = packages.filter(pkg => {
    const searchLower = packageSearch.toLowerCase()
    const isNotInWhitelist = !config.whitelist.includes(pkg.package)
    return isNotInWhitelist && (
      pkg.package.toLowerCase().includes(searchLower) ||
      (pkg.label && pkg.label.toLowerCase().includes(searchLower))
    )
  })

  const refreshDevices = () => {
    socketService.requestDeviceList()
  }

  // Get package info for whitelist items
  const getPackageInfo = (packageName: string) => {
    return packages.find(p => p.package === packageName)
  }

  if (!isConnected) {
    return (
      <div className="container mx-auto px-4 py-8 lg:px-8 max-w-3xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <Server className="h-8 w-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Module Configuration
          </h1>
          <p className="text-slate-600">
            Connect to a device to configure the DANR Zygisk module
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
                          {device.ipAddress && ` - ${device.ipAddress}`}
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
            Module Configuration
          </h1>
          <p className="text-slate-600 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Connected to: <span className="font-medium">{deviceUrl}</span>
            {selectedDevice && (
              <span className="text-slate-400">({selectedDevice.model})</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Save status indicator */}
          {saveStatus === 'saving' && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </div>
          )}
          {saveStatus === 'saved' && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <CheckCircle2 className="h-4 w-4" />
              Saved
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <X className="h-4 w-4" />
              Save failed
            </div>
          )}
          <Button variant="outline" onClick={fetchConfig} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
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

      <Tabs value={activeTab} onValueChange={(value) => {
        setActiveTab(value)
        if (value === 'logs') {
          fetchLogs()
        }
      }} className="space-y-6">
        <TabsList>
          <TabsTrigger value="whitelist">App Whitelist</TabsTrigger>
          <TabsTrigger value="settings">DANR Settings</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        {/* Whitelist Tab - Combined with package browser */}
        <TabsContent value="whitelist">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Current Whitelist */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 rounded-lg">
                    <Package className="h-5 w-5 text-slate-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Monitored Apps</CardTitle>
                    <CardDescription>Apps with DANR SDK injected ({config.whitelist.length})</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {config.whitelist.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No apps in whitelist</p>
                    <p className="text-sm">Add apps from the list on the right</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {config.whitelist.map((pkg) => {
                      const pkgInfo = getPackageInfo(pkg)
                      return (
                        <div
                          key={pkg}
                          className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg"
                        >
                          <div className="min-w-0 flex-1">
                            {pkgInfo?.label && (
                              <p className="font-medium text-sm truncate">{pkgInfo.label}</p>
                            )}
                            <p className="font-mono text-xs text-slate-500 truncate">{pkg}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveFromWhitelist(pkg)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 ml-2 flex-shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Add package manually */}
                <div className="pt-4 mt-4 border-t">
                  <label className="block text-xs text-slate-500 mb-2">
                    Add package manually
                  </label>
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const input = e.currentTarget.elements.namedItem('packageName') as HTMLInputElement
                      if (input.value.trim()) {
                        handleAddToWhitelist(input.value.trim())
                        input.value = ''
                      }
                    }}
                  >
                    <input
                      type="text"
                      name="packageName"
                      placeholder="com.example.app"
                      className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <Button type="submit" size="sm">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>

            {/* Available Packages */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 rounded-lg">
                      <Search className="h-5 w-5 text-slate-600" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Available Packages</CardTitle>
                      <CardDescription>Browse and add installed apps</CardDescription>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={fetchPackages} disabled={packagesLoading}>
                    <RefreshCw className={`h-4 w-4 ${packagesLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {packagesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                  </div>
                ) : packages.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No packages loaded</p>
                    <Button variant="outline" className="mt-4" onClick={fetchPackages}>
                      Load Packages
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mb-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                          type="text"
                          value={packageSearch}
                          onChange={(e) => setPackageSearch(e.target.value)}
                          placeholder="Search packages..."
                          className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {filteredPackages.length} available packages
                      </p>
                    </div>

                    <div className="max-h-[400px] overflow-y-auto space-y-2">
                      {filteredPackages.map((pkg) => (
                        <div
                          key={pkg.package}
                          className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            {pkg.label && (
                              <p className="font-medium text-sm truncate">{pkg.label}</p>
                            )}
                            <p className="font-mono text-xs text-slate-500 truncate">{pkg.package}</p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAddToWhitelist(pkg.package)}
                            className="ml-2 flex-shrink-0"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Backend Settings */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 rounded-lg">
                    <Server className="h-5 w-5 text-slate-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Backend Settings</CardTitle>
                    <CardDescription>Configure where ANR reports are sent</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">
                    Backend URL
                  </label>
                  <input
                    type="text"
                    value={config.danrConfig.backendUrl}
                    onChange={(e) => handleDanrConfigChange('backendUrl', e.target.value)}
                    placeholder="http://localhost:8080"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 mb-1">
                    ANR Threshold (ms)
                  </label>
                  <input
                    type="number"
                    value={config.danrConfig.anrThresholdMs}
                    onChange={(e) => handleDanrConfigChange('anrThresholdMs', parseInt(e.target.value) || 5000)}
                    min={1000}
                    max={30000}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Time before considering a main thread block as an ANR
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Monitoring Settings */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 rounded-lg">
                    <Settings className="h-5 w-5 text-slate-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Monitoring Settings</CardTitle>
                    <CardDescription>Control when ANR monitoring is active</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="flex items-center justify-between p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                  <div>
                    <span className="text-sm font-medium text-slate-700">Enable in Release builds</span>
                    <p className="text-xs text-slate-500">Monitor ANRs in production builds</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.danrConfig.enableInRelease}
                    onChange={(e) => handleDanrConfigChange('enableInRelease', e.target.checked)}
                    className="rounded border-slate-300 h-5 w-5"
                  />
                </label>

                <label className="flex items-center justify-between p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                  <div>
                    <span className="text-sm font-medium text-slate-700">Enable in Debug builds</span>
                    <p className="text-xs text-slate-500">Monitor ANRs in development builds</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.danrConfig.enableInDebug}
                    onChange={(e) => handleDanrConfigChange('enableInDebug', e.target.checked)}
                    className="rounded border-slate-300 h-5 w-5"
                  />
                </label>

                <label className="flex items-center justify-between p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                  <div>
                    <span className="text-sm font-medium text-slate-700">Auto-start monitoring</span>
                    <p className="text-xs text-slate-500">Start monitoring when app launches</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.danrConfig.autoStart}
                    onChange={(e) => handleDanrConfigChange('autoStart', e.target.checked)}
                    className="rounded border-slate-300 h-5 w-5"
                  />
                </label>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 rounded-lg">
                    <FileText className="h-5 w-5 text-slate-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">DANR Logs</CardTitle>
                    <CardDescription>Recent DANR-related log entries from the device</CardDescription>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={fetchLogs} disabled={logsLoading}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${logsLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : logs ? (
                <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto text-xs font-mono max-h-[500px] overflow-y-auto">
                  {logs}
                </pre>
              ) : (
                <div className="text-center py-12 text-slate-500">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No logs available</p>
                  <Button variant="outline" className="mt-4" onClick={fetchLogs}>
                    Load Logs
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
