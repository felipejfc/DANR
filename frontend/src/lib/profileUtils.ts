import { profileApi } from './api';

/**
 * Format duration between two ISO timestamps
 */
export function formatDuration(startTime: string, endTime: string): string {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const durationMs = end - start;
  const seconds = Math.floor(durationMs / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Download a profile trace file
 */
export async function downloadProfileTrace(
  sessionId: string,
  profilerType: 'java' | 'simpleperf'
): Promise<void> {
  const isSimpleperf = profilerType === 'simpleperf';

  try {
    const blob = isSimpleperf
      ? await profileApi.getRawTrace(sessionId)
      : await profileApi.getPerfettoExport(sessionId, false);

    // Check if response is an error JSON instead of blob
    if (blob.type === 'application/json') {
      const text = await blob.text();
      try {
        const json = JSON.parse(text);
        if (json.error) {
          throw new Error(json.error);
        }
      } catch {
        // Not JSON error, continue
      }
    }

    const filename = isSimpleperf
      ? `profile-${sessionId}.perfetto-trace`
      : `profile-${sessionId}.json`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error: unknown) {
    // Handle axios error response
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as { response?: { data?: Blob | { error?: string } } };
      if (axiosError.response?.data instanceof Blob) {
        const text = await axiosError.response.data.text();
        try {
          const json = JSON.parse(text);
          throw new Error(json.error || 'Export failed');
        } catch (e) {
          if (e instanceof Error && e.message !== 'Export failed') {
            throw new Error(`Export failed: ${text}`);
          }
          throw e;
        }
      }
    }
    throw error;
  }
}
