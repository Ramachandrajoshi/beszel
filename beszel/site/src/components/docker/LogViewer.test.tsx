// beszel/site/src/components/docker/LogViewer.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WritableAtom } from 'nanostores';
import { $router } from '@/components/router';
import LogViewer from './LogViewer';
// Assuming getDockerContainerLogsStreamUrl is used internally by fetchLogs or directly
import * as api from '@/lib/api';

// Mock global fetch
global.fetch = vi.fn();

// Mock @nanostores/react's useStore hook (similar to ContainerList.test.tsx)
vi.mock('@nanostores/react', async () => {
  const nanostoresReact = await vi.importActual('@nanostores/react');
  const { atom } = await import('nanostores');
  // Create a local mock for router params that can be controlled in tests
  const mockRouterParamsAtom = atom<Record<string, string | undefined>>({});

  return {
    ...(nanostoresReact as object), // Spread actual exports
    useStore: (store: Store) => {
      if (store === $router.params) {
        // Return the value of our controllable mock atom when $router.params is used
        return mockRouterParamsAtom.get();
      }
      // For any other store, use its actual value.
      return store.get();
    },
    // Helper to set params for tests, not part of the actual mock, but used by tests
    __setMockRouterParams: (params: Record<string, string | undefined>) => mockRouterParamsAtom.set(params),
  };
});


describe('LogViewer Component', () => {
  const mockAgentId = 'agent-x';
  const mockContainerId = 'container-y';

  // Helper to set router params using the mock's exported function
  const setMockRouterParams = async (params: Record<string, string | undefined>) => {
    const { __setMockRouterParams } = await import('@nanostores/react');
    __setMockRouterParams(params);
  };


  beforeEach(async () => {
    vi.resetAllMocks();
    // Set default params for most tests
    await setMockRouterParams({ agentId: mockAgentId, containerId: mockContainerId });

    // Default fetch mock for logs - can be overridden in specific tests
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: URL | RequestInfo) => {
        const urlString = typeof url === 'string' ? url : url.url;
        if (urlString.includes('/logs')) {
            return Promise.resolve({
                ok: true,
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode("Log line 1 from mock\n"));
                        controller.enqueue(new TextEncoder().encode("Log line 2 from mock\n"));
                        controller.close();
                    },
                }),
                text: async () => "Log line 1 from mock\nLog line 2 from mock\n", // Fallback for non-streaming
            } as Response);
        }
        return Promise.resolve({ ok: false, status: 404, text: async () => "Not Found" } as Response);
    });
  });

  it('should render controls (since, tail, follow, fetch button)', () => {
    render(<LogViewer />);
    expect(screen.getByLabelText(/Since/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tail/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Follow/i)).toBeInTheDocument(); // Switch has an associated label
    expect(screen.getByRole('button', { name: /Fetch Logs/i })).toBeInTheDocument();
  });

  it('should call fetch with correct URL when "Fetch Logs" is clicked', async () => {
    const getLogsUrlSpy = vi.spyOn(api, 'getDockerContainerLogsStreamUrl');
    render(<LogViewer />);

    fireEvent.change(screen.getByLabelText(/Since/i), { target: { value: '10m' } });
    fireEvent.change(screen.getByLabelText(/Tail/i), { target: { value: '50' } });
    // For Switch, click the role="switch" element
    fireEvent.click(screen.getByRole('switch', { name: /Follow/i }));
    fireEvent.click(screen.getByRole('button', { name: /Fetch Logs/i }));

    await waitFor(() => {
      expect(getLogsUrlSpy).toHaveBeenCalledWith(mockAgentId, mockContainerId, {
        since: '10m',
        tail: '50',
        follow: true, // Follow should be true after click
      });
      expect(fetch).toHaveBeenCalled();
      // expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/api/agent/${mockAgentId}/docker/containers/${mockContainerId}/logs?since=10m&tail=50&follow=true`));
    });
  });

  it('should display fetched logs', async () => {
    render(<LogViewer />);
    fireEvent.click(screen.getByRole('button', { name: /Fetch Logs/i }));

    await waitFor(() => {
      expect(screen.getByText(/Log line 1 from mock/i)).toBeInTheDocument();
      expect(screen.getByText(/Log line 2 from mock/i)).toBeInTheDocument();
    });
  });

  it('should display error if agentId or containerId is missing', async () => {
    await setMockRouterParams({}); // Clear params
    render(<LogViewer />);
    fireEvent.click(screen.getByRole('button', { name: /Fetch Logs/i }));

    await waitFor(() => {
         expect(screen.getByText(/Error: Agent ID or Container ID not found in URL./i)).toBeInTheDocument();
    });
     await setMockRouterParams({ agentId: mockAgentId, containerId: mockContainerId }); // reset
  });


  it('should display error message if fetching logs fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () =>
        Promise.resolve({
            ok: false,
            status: 500,
            text: async () => 'Server Error',
        } as Response)
    );
    render(<LogViewer />);
    fireEvent.click(screen.getByRole('button', { name: /Fetch Logs/i }));

    await waitFor(() => {
      expect(screen.getByText(/Error: Failed to fetch logs: 500 Server Error/i)).toBeInTheDocument();
    });
  });

  // More complex tests for `follow` mode (continuous streaming) and aborting:
  // - These would require more sophisticated mocking of `fetch` and `ReadableStream`.
  // - For example, to test abort: trigger a fetch, then toggle `follow` off, and assert
  //   that `abortController.abort()` was called (might need to spy on AbortController).
  it.todo('handles continuous log streaming when follow is active');
  it.todo('aborts ongoing fetch when follow is toggled off or component unmounts');
  it.todo('aborts previous fetch if "Fetch Logs" is clicked again');

});
