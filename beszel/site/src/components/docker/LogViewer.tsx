// beszel/site/src/components/docker/LogViewer.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { $router } from '@/components/router'; // Using Nanostores router
import { useStore } from '@nanostores/react'; // For reactive updates to params
import { getDockerContainerLogsStreamUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch'; // For the follow toggle
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const LogViewer: React.FC = () => {
  const params = useStore($router.params);
  const agentId = params.get()?.agentId as string | undefined;
  const containerId = params.get()?.containerId as string | undefined;

  const [logs, setLogs] = useState<string[]>([]);
  const [since, setSince] = useState<string>(''); // e.g., "10m", "1h", specific timestamp
  const [tail, setTail] = useState<string>('100'); // e.g., "100", "all"
  const [follow, setFollow] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (follow) {
      scrollToBottom();
    }
  }, [logs, follow]);

  // Cleanup function to abort fetch if component unmounts or follow changes
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);


  const fetchLogs = useCallback(async () => {
    if (!agentId || !containerId) {
      setError('Agent ID or Container ID not found in URL.');
      return;
    }

    // Abort any ongoing fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setIsLoading(true);
    setError(null);
    setLogs([]); // Clear previous logs

    const streamUrl = getDockerContainerLogsStreamUrl(agentId, containerId, {
      since: since || undefined, // Send only if not empty
      tail: tail || undefined,   // Send only if not empty
      follow,
    });

    try {
      const response = await fetch(streamUrl, { signal });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch logs: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.length > 0) { // Process any remaining buffer
            setLogs(prev => [...prev, buffer]);
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        // Process line by line
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.substring(0, newlineIndex);
          setLogs(prev => [...prev, line]);
          buffer = buffer.substring(newlineIndex + 1);
        }
        // If not following, and we have processed the initial chunk, we might stop early
        // For simplicity, this loop continues until 'done' or aborted
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
      } else if (err instanceof Error && err.name === 'AbortError') {
        setError(null); // Clear error if it's a user-initiated abort
        slog.Debug('Log fetching aborted by user.');
      } else {
        setError('An unknown error occurred while fetching logs.');
      }
    } finally {
      setIsLoading(false);
      if (signal.aborted) {
         slog.Debug('Log fetching process finished due to abort.');
      }
    }
  }, [agentId, containerId, since, tail, follow]);

  // Stop following when follow is toggled off
  useEffect(() => {
    if (!follow && abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false); // Manually set loading to false as fetchLogs won't be called
    }
  }, [follow]);


  return (
    <div className="p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Logs for Container {containerId?.substring(0,12)}</CardTitle>
          <p className="text-sm text-muted-foreground">Agent: {agentId}</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div>
              <Label htmlFor="since">Since</Label>
              <Input id="since" value={since} onChange={(e) => setSince(e.target.value)} placeholder="e.g., 10m, 1h, YYYY-MM-DDTHH:MM:SS" />
            </div>
            <div>
              <Label htmlFor="tail">Tail</Label>
              <Input id="tail" value={tail} onChange={(e) => setTail(e.target.value)} placeholder="e.g., 100, all" />
            </div>
            <div className="flex items-end">
              <div className="flex items-center space-x-2">
                <Switch id="follow" checked={follow} onCheckedChange={setFollow} />
                <Label htmlFor="follow">Follow</Label>
              </div>
            </div>
            <div className="flex items-end">
              <Button onClick={fetchLogs} disabled={isLoading || (!agentId || !containerId)}>
                {isLoading ? (follow ? 'Following...' : 'Loading...') : 'Fetch Logs'}
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

// A dummy slog object for browser environment if not available
const slog = globalThis.slog || {
  Debug: (...args: unknown[]) => console.debug(...args),
  Info: (...args: unknown[]) => console.info(...args),
  Warn: (...args: unknown[]) => console.warn(...args),
  Error: (...args: unknown[]) => console.error(...args),
};


export default LogViewer;
