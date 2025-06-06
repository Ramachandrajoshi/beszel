// beszel/site/src/components/docker/ContainerList.tsx
import React, { useEffect, useState } from 'react';
import { $router, Link, prependBasePath } from '@/components/router'; // Using Nanostores router
import { useStore } from '@nanostores/react'; // For reactive updates to params
import { getDockerContainers, ApiContainerInfo } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExternalLink } from 'lucide-react'; // For "View Logs" icon

// Helper to get the first name of a container
const getContainerFirstName = (names: string[]): string => {
  if (!names || names.length === 0) {
    return 'N/A';
  }
  return names[0].startsWith('/') ? names[0].substring(1) : names[0];
};

const ContainerList: React.FC = () => {
  const params = useStore($router.params);
  const agentId = params.get()?.agentId as string | undefined;

  const [containers, setContainers] = useState<ApiContainerInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) {
      setError('Agent ID not found in URL.');
      setLoading(false);
      return;
    }

    const fetchContainers = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getDockerContainers(agentId);
        setContainers(data);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred.');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchContainers();
  }, [agentId]);

  if (loading) {
    return <div className="p-4">Loading Docker containers...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-500">Error: {error}</div>;
  }

  if (!agentId) {
    return <div className="p-4 text-red-500">Error: Agent ID is missing. Cannot load containers.</div>;
  }

  if (containers.length === 0 && !loading) { // Show no containers only if not loading
    return <div className="p-4">No Docker containers found for this agent.</div>;
  }

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-2xl font-semibold mb-4">Docker Containers for Agent {agentId || '...'}</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Short ID</TableHead>
            <TableHead>Image</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {containers.map((container) => (
            <TableRow key={container.Id}>
              <TableCell>{getContainerFirstName(container.Names)}</TableCell>
              <TableCell>{container.IdShort}</TableCell>
              <TableCell>{container.Image}</TableCell>
              <TableCell>{container.Status}</TableCell>
              <TableCell>
                <Button asChild variant="outline" size="sm">
                  {/* Construct path using $router.routes object if available, or manually */}
                  <Link href={prependBasePath(`/agents/${agentId}/docker/${container.Id}/logs`)}>
                    View Logs
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default ContainerList;
