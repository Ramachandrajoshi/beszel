import React, { useEffect, useState, useRef } from 'react';
import { pb } from '@/lib/stores'; // Assuming pb is exported from stores
import { t } from '@lingui/core/macro'; // For i18n
import { useLingui } from '@lingui/react/macro'; // For i18n
import Spinner from './spinner'; // Assuming Spinner component exists
import { Button } from './ui/button';
import { XIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface ContainerLogViewProps {
  systemId: string;
  containerId: string;
  containerName: string;
  onClose: () => void;
}

interface LogResponse {
  logs: string;
}

const ContainerLogView: React.FC<ContainerLogViewProps> = ({
  systemId,
  containerId,
  containerName,
  onClose,
}) => {
  useLingui(); // Initialize Lingui
  const [logs, setLogs] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLogs = async () => {
    if (!systemId || !containerId) {
      setError(t`System ID or Container ID is missing.`);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await pb.send<LogResponse>(
        `/api/beszel/container_logs?system_id=${encodeURIComponent(systemId)}&container_id=${encodeURIComponent(containerId)}&tail=100`,
        {} // Empty options for GET request
      );
      setLogs(response.logs);
    } catch (err: any) {
      setError(err.message || t`Failed to fetch logs.`);
      setLogs(''); // Clear logs on error
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(); // Initial fetch

    // Set up polling
    pollingIntervalRef.current = setInterval(fetchLogs, 2000);

    // Clear interval on component unmount or when props change
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [systemId, containerId]);

  useEffect(() => {
    // Scroll to the bottom of the logs
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-3xl h-[80vh] flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between py-3 px-4 border-b">
          <CardTitle className="text-lg">
            {t`Logs for container:`} {containerName}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t`Close log view`}>
            <XIcon className="h-5 w-5" />
          </Button>
        </CardHeader>
        <CardContent className="flex-grow overflow-y-auto p-0">
          {isLoading && !logs && ( // Show spinner only on initial load
            <div className="flex items-center justify-center h-full">
              <Spinner />
            </div>
          )}
          {error && (
            <div className="p-4 text-red-500">
              <p>{t`Error:`} {error}</p>
              <Button onClick={fetchLogs} className="mt-2">{t`Retry`}</Button>
            </div>
          )}
          {!error && logs && (
            <pre className="p-4 text-sm whitespace-pre-wrap break-all h-full">
              {logs}
              <div ref={logsEndRef} />
            </pre>
          )}
           {!error && !logs && !isLoading && (
             <div className="p-4 text-center text-muted-foreground">{t`No logs to display or container has not produced output.`}</div>
           )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ContainerLogView;
