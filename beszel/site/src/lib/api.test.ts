// beszel/site/src/lib/api.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDockerContainers, getDockerContainerLogsStreamUrl, ApiContainerInfo } from './api';

// Mock global fetch
global.fetch = vi.fn();

describe('lib/api', () => {
  beforeEach(() => {
    vi.resetAllMocks(); // Reset mocks before each test
  });

  describe('getDockerContainers', () => {
    const agentId = 'test-agent';

    it('should fetch and return container data on success', async () => {
      const mockContainers: ApiContainerInfo[] = [
        { Id: '1', Names: ['/c1'], Image: 'img1', IdShort: '1short', State: 'running', Status: 'Up', Command: '', Created: 0, ImageID: '', Labels:{}, Mounts:[], Ports:[], HostConfig: {NetworkMode: ''}, NetworkSettings:{ Networks: {}}},
        { Id: '2', Names: ['/c2'], Image: 'img2', IdShort: '2short', State: 'exited', Status: 'Exited', Command: '', Created: 0, ImageID: '', Labels:{}, Mounts:[], Ports:[], HostConfig: {NetworkMode: ''}, NetworkSettings:{ Networks: {}}},
      ];
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockContainers,
      } as Response);

      const result = await getDockerContainers(agentId);
      expect(fetch).toHaveBeenCalledWith(`/api/agent/${agentId}/docker/containers`);
      expect(result).toEqual(mockContainers);
    });

    it('should throw an error if agentId is not provided', async () => {
      await expect(getDockerContainers('')).rejects.toThrow('Agent ID is required');
    });

    it('should throw an error on network failure', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
      await expect(getDockerContainers(agentId)).rejects.toThrow('Network error');
    });

    it('should throw an error on non-ok response', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      } as Response);

      await expect(getDockerContainers(agentId)).rejects.toThrow('Failed to fetch Docker containers: 404 Not Found');
    });
  });

  describe('getDockerContainerLogsStreamUrl', () => {
    const agentId = 'test-agent';
    const containerId = 'test-container';

    it('should construct the URL correctly with no optional params', () => {
      const expectedUrl = `http://localhost/api/agent/${agentId}/docker/containers/${containerId}/logs`;
      // Note: window.location.origin is 'http://localhost' in Vitest/JSDOM default environment
      const result = getDockerContainerLogsStreamUrl(agentId, containerId);
      expect(result).toBe(expectedUrl);
    });

    it('should construct the URL correctly with all optional params', () => {
      const params = { since: '1h', tail: '100', follow: true };
      const expectedUrl = `http://localhost/api/agent/${agentId}/docker/containers/${containerId}/logs?since=1h&tail=100&follow=true`;
      const result = getDockerContainerLogsStreamUrl(agentId, containerId, params);
      expect(result).toBe(expectedUrl);
    });

    it('should construct the URL correctly with some optional params', () => {
      const params = { since: '10m', follow: false };
      const expectedUrl = `http://localhost/api/agent/${agentId}/docker/containers/${containerId}/logs?since=10m&follow=false`;
      const result = getDockerContainerLogsStreamUrl(agentId, containerId, params);
      expect(result).toBe(expectedUrl);
    });

    it('should throw an error if agentId or containerId is not provided', () => {
      expect(() => getDockerContainerLogsStreamUrl('', 'container')).toThrow('Agent ID and Container ID are required');
      expect(() => getDockerContainerLogsStreamUrl('agent', '')).toThrow('Agent ID and Container ID are required');
    });
  });
});
