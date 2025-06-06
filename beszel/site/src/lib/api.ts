// Beszel/site/src/lib/api.ts

/**
 * Represents the information about a Docker container as returned by the API.
 * Based on beszel/internal/entities/container/container.go ApiInfo struct
 */
export interface ApiContainerInfo {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  Command: string;
  Created: number;
  Ports: unknown[]; // Actual type might be more specific if needed
  SizeRw?: number;
  SizeRootFs?: number;
  Labels: Record<string, string>;
  State: string; // e.g., "running", "exited"
  Status: string; // e.g., "Up 2 hours", "Exited (0) 2 days ago"
  HostConfig: {
    NetworkMode: string;
  };
  NetworkSettings: {
    Networks: Record<string, unknown>; // Actual type might be more specific
  };
  Mounts: unknown[]; // Actual type might be more specific
  IdShort: string; // Derived field, first 12 chars of Id
}

const BASE_API_URL = '/api/agent'; // Adjust if your API proxy is different

/**
 * Fetches the list of Docker containers for a given agent.
 * @param agentId The ID of the agent.
 * @returns A promise that resolves to an array of ApiContainerInfo.
 */
export async function getDockerContainers(agentId: string): Promise<ApiContainerInfo[]> {
  if (!agentId) {
    throw new Error('Agent ID is required');
  }
  const response = await fetch(`${BASE_API_URL}/${agentId}/docker/containers`);
  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Failed to fetch Docker containers: ${response.status} ${errorData}`);
  }
  return response.json() as Promise<ApiContainerInfo[]>;
}

/**
 * Constructs the URL for streaming Docker container logs.
 * @param agentId The ID of the agent.
 * @param containerId The ID of the container.
 * @param params Optional parameters for log fetching.
 * @returns The URL string for the log stream.
 */
export function getDockerContainerLogsStreamUrl(
  agentId: string,
  containerId: string,
  params?: { since?: string; tail?: string; follow?: boolean }
): string {
  if (!agentId || !containerId) {
    throw new Error('Agent ID and Container ID are required');
  }
  const url = new URL(`${window.location.origin}${BASE_API_URL}/${agentId}/docker/containers/${containerId}/logs`);
  if (params?.since) {
    url.searchParams.append('since', params.since);
  }
  if (params?.tail) {
    url.searchParams.append('tail', params.tail);
  }
  if (params?.follow !== undefined) {
    url.searchParams.append('follow', String(params.follow));
  }
  return url.toString();
}
