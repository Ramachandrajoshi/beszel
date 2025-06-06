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

const BASE_API_URL = '/api'; // Adjust if your API proxy is different. Base for /docker/logs will be this.

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
 * Constructs the URL for fetching Docker container logs.
 * @param agentId The ID of the agent.
 * @param containerId The ID of the container.
 * @param params Optional parameters for log fetching (since, tail).
 * @returns The URL string for fetching logs.
 */
export function getDockerContainerLogsUrl(
  agentId: string,
  containerId: string,
  params?: { since?: string; tail?: string }
): string {
  if (!agentId || !containerId) {
    throw new Error('Agent ID and Container ID are required');
  }
  // Note: window.location.origin is used to ensure the path is absolute.
  // BASE_API_URL is now just /api, and we append /docker/logs
  const url = new URL(`${window.location.origin}${BASE_API_URL}/docker/logs`);
  url.searchParams.append('agentId', agentId);
  url.searchParams.append('containerId', containerId);

  if (params?.since) {
    url.searchParams.append('since', params.since);
  }
  if (params?.tail) {
    url.searchParams.append('tail', params.tail);
  }
  return url.toString();
}
