// beszel/site/src/components/docker/LogViewer.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { $router } from '@/components/router'; // Using Nanostores router
import { useStore } from '@nanostores/react'; // For reactive updates to params
import { getDockerContainerLogsUrl } from '@/lib/api'; // Updated import
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// Switch is removed as 'follow' functionality is gone
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const LogViewer: React.FC = () => {
  const params = useStore($router.params);
  const agentId = params.get()?.agentId as string | undefined;
  const containerId = params.get()?.containerId as string | undefined;

  const [logs, setLogs] = useState<string[]>([]);
  const [since, setSince] = useState<string>(''); // e.g., "10m", "1h", specific timestamp
  const [tail, setTail] = useState<string>('100'); // e.g., "100", "all"
  // follow state is removed
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  // abortControllerRef is removed

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Scroll to bottom when logs change
  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  // Cleanup effect for aborting is removed as we are not using AbortController in the same way

  const fetchLogs = useCallback(async () => {
    if (!agentId || !containerId) {
      setError('Agent ID or Container ID not found in URL.');
      return;
    }

    // AbortController logic removed

    setIsLoading(true);
    setError(null);
    setLogs([]); // Clear previous logs

    const logsUrl = getDockerContainerLogsUrl(agentId, containerId, { // Updated function call
      since: since || undefined, // Send only if not empty
      tail: tail || undefined,   // Send only if not empty
      // follow parameter is removed
    });

    try {
      const response = await fetch(logsUrl); // Signal is removed
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch logs: ${response.status} ${errorText}`);
      }

      // Process logs as a single text blob
      const text = await response.text();
      const lines = text.split('\n');
      setLogs(lines);

      // Removed while loop and TextDecoder logic
    } catch (err) {
      // Simplified error handling as AbortError is no longer expected from our controller
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred while fetching logs.');
      }
    } finally {
      setIsLoading(false);
      // slog.Debug for abort is removed
    }
  }, [agentId, containerId, since, tail]); // follow is removed from dependencies

  // Effect for stopping follow when toggled off is removed

  return (
    <div className="p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Logs for Container {containerId?.substring(0,12)}</CardTitle>
          <p className="text-sm text-muted-foreground">Agent: {agentId}</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-6"> {/* Adjusted grid cols */}
            <div>
              <Label htmlFor="since">Since</Label>
              <Input id="since" value={since} onChange={(e) => setSince(e.target.value)} placeholder="e.g., 10m, 1h, YYYY-MM-DDTHH:MM:SS" />
            </div>
            <div>
              <Label htmlFor="tail">Tail</Label>
              <Input id="tail" value={tail} onChange={(e) => setTail(e.target.value)} placeholder="e.g., 100, all" />
            </div>
            {/* Follow Switch and Label removed */}
            <div className="flex items-end">
              <Button onClick={fetchLogs} disabled={isLoading || (!agentId || !containerId)}>
                {isLoading ? 'Loading...' : 'Fetch Logs'} {/* Simplified button text */}
              </Button>
            </div>
          </div>

          {error && <p className="text-red-500 mb-4">Error: {error}</p>}

          <div className="bg-gray-900 text-white font-mono text-sm p-4 rounded-md overflow-x-auto h-96 max-h-[70vh]">
            <pre>
              {logs.map((line, index) => (
                <div key={index}>{line}</div>
              ))}
            </pre>
            <div ref={logsEndRef} /> {/* For auto-scrolling */}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// slog usage was minimal and related to abort, can be removed or kept if other debug logs are added.
// For now, let's remove the explicit slog object definition if not used elsewhere in this file.
// const slog = globalThis.slog || {
//   Debug: (...args: unknown[]) => console.debug(...args),
//   Info: (...args: unknown[]) => console.info(...args),
//   Warn: (...args: unknown[]) => console.warn(...args),
//   Error: (...args: unknown[]) => console.error(...args),
// };


export default LogViewer;
