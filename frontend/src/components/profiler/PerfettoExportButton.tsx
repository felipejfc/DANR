'use client';

import { useState } from 'react';
import { Download, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { downloadProfileTrace } from '@/lib/profileUtils';
import { Button } from '@/components/ui/button';

interface PerfettoExportButtonProps {
  sessionId: string;
  profilerType?: 'java' | 'simpleperf';
  disabled?: boolean;
}

export default function PerfettoExportButton({ sessionId, profilerType = 'java', disabled }: PerfettoExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    try {
      await downloadProfileTrace(sessionId, profilerType);
    } catch (err) {
      console.error('Failed to export profile:', err);
      const message = err instanceof Error ? err.message : 'Failed to export profile';
      setError(message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button
          onClick={handleExport}
          disabled={disabled || isExporting}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
        >
          {isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export for Perfetto
        </Button>

        <Button
          variant="outline"
          onClick={() => window.open('https://ui.perfetto.dev', '_blank')}
          disabled={disabled}
          className="flex items-center gap-2"
          title="Open Perfetto UI to load the exported file"
        >
          <ExternalLink className="h-4 w-4" />
          Open Perfetto UI
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded border border-red-200">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
