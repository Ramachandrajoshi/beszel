// beszel/site/src/components/docker/ContainerList.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Store, WritableAtom } from 'nanostores'; // Import types for Nanostores
import { $router } from '@/components/router'; // Actual router import
import ContainerList from './ContainerList';
import * as api from '@/lib/api'; // To mock getDockerContainers
import { ApiContainerInfo } from '@/lib/api';

// Mock the API module
vi.mock('@/lib/api');

// Mock the router store. We need to provide a mock implementation for $router.params
// This is a simplified mock. A more complete one might involve a helper library or more setup.
let mockParamsStore: WritableAtom<Record<string, string | undefined>>;

// Helper to set params for a test
const setRouterParams = (params: Record<string, string | undefined>) => {
  if (mockParamsStore) {
    mockParamsStore.set(params);
  } else {
    // Fallback if store not yet initialized by useStore in component, though usually it is.
    // This direct manipulation is for setup.
    ($router.params as unknown as WritableAtom<Record<string, string | undefined>>).set(params);
  }
};

// Mock @nanostores/react's useStore hook
vi.mock('@nanostores/react', () => ({
  useStore: (store: Store) => {
    // For $router.params, we need to ensure it's initialized and settable for tests
    if (store === $router.params) {
      if (!mockParamsStore) {
         // Create a writable atom for params if not exists, this is a simplified approach
        const { atom } = await import('nanostores'); // Dynamically import atom for test setup
        mockParamsStore = atom<Record<string, string | undefined>>({});
      }
      // This part of the mock needs to return the actual store's value,
      // but allow us to set it for testing. This is tricky.
      // A common pattern is to have the mock store return a value from a test-controlled variable.
      // For simplicity, we'll assume the store passed to useStore can be directly manipulated
      // if it's our mock, or we use a test-specific atom that the component will pick up.
      // The `setRouterParams` helper will be used to control its value.
      // This mocking strategy might need refinement based on how `useStore` and components interact.
      // Let's assume `useStore` will correctly use the `$router.params` which we can try to set.
      // A more robust mock might involve returning a static value that tests can change.
      // For now, the actual $router.params will be used and we'll try to set it.
       return store.get(); // This will use the actual store's value, which we try to set via setRouterParams
    }
    return store.get(); // Default behavior for other stores
  },
}));


describe('ContainerList Component', () => {
  const mockAgentId = 'test-agent-123';

  beforeEach(async () => {
    vi.resetAllMocks();
    // Ensure router params can be set for each test
    // This dynamic import inside mock is tricky. Let's try simpler $router.params.set if writable.
    // Or, more typically, mock the return value of useStore($router.params)
    // The current mock for useStore is basic. A better one would be:
    // const mockRouterParams = atom({}); vi.mocked($router.params).get = () => mockRouterParams.get();
    // For now, we rely on setting the actual $router.params store if it's directly settable,
    // or the useStore mock correctly picking up changes if we set $router.params.
    // Let's assume `setRouterParams` correctly influences what `useStore($router.params)` returns.
     ($router.params as WritableAtom<Record<string, string | undefined>>).set({ agentId: mockAgentId });

  });

  it('should display loading state initially', () => {
    (api.getDockerContainers as vi.Mock).mockReturnValue(new Promise(() => {})); // Keep it pending
    render(<ContainerList />);
    expect(screen.getByText(/Loading Docker containers.../i)).toBeInTheDocument();
  });

  it('should display an error message if fetching containers fails', async () => {
    (api.getDockerContainers as vi.Mock).mockRejectedValueOnce(new Error('Failed to fetch'));
    render(<ContainerList />);
    await waitFor(() => {
      expect(screen.getByText(/Error: Failed to fetch/i)).toBeInTheDocument();
    });
  });

  it('should display an error message if agentId is missing', async () => {
    ($router.params as WritableAtom<Record<string, string | undefined>>).set({}); // No agentId
    render(<ContainerList />);
    await waitFor(() => {
      expect(screen.getByText(/Error: Agent ID is missing. Cannot load containers./i)).toBeInTheDocument();
    });
     ($router.params as WritableAtom<Record<string, string | undefined>>).set({ agentId: mockAgentId }); // reset
  });

  it('should display "No Docker containers found" if list is empty', async () => {
    (api.getDockerContainers as vi.Mock).mockResolvedValueOnce([]);
    render(<ContainerList />);
    await waitFor(() => {
      expect(screen.getByText(/No Docker containers found for this agent./i)).toBeInTheDocument();
    });
  });

  it('should display container data in a table', async () => {
    const mockContainers: ApiContainerInfo[] = [
      { Id: 'id1', IdShort: 'id1short', Names: ['/con1'], Image: 'image:latest', Status: 'Up 2 hours', Command: '', Created: 0, ImageID: '', Labels:{}, Mounts:[], Ports:[], HostConfig: {NetworkMode: ''}, NetworkSettings:{ Networks: {}}},
      { Id: 'id2', IdShort: 'id2short', Names: ['/con2'], Image: 'another/image:v1', Status: 'Exited (0) 1 day ago', Command: '', Created: 0, ImageID: '', Labels:{}, Mounts:[], Ports:[], HostConfig: {NetworkMode: ''}, NetworkSettings:{ Networks: {}}},
    ];
    (api.getDockerContainers as vi.Mock).mockResolvedValueOnce(mockContainers);
    render(<ContainerList />);

    await waitFor(() => {
      expect(screen.getByText('con1')).toBeInTheDocument();
      expect(screen.getByText('id1short')).toBeInTheDocument();
      expect(screen.getByText('image:latest')).toBeInTheDocument();
      expect(screen.getByText('Up 2 hours')).toBeInTheDocument();

      expect(screen.getByText('con2')).toBeInTheDocument();
      expect(screen.getByText('id2short')).toBeInTheDocument();
      expect(screen.getByText('another/image:v1')).toBeInTheDocument();
      expect(screen.getByText('Exited (0) 1 day ago')).toBeInTheDocument();
    });

    // Check for "View Logs" links
    const viewLogsLinks = screen.getAllByRole('link', { name: /View Logs/i });
    expect(viewLogsLinks).toHaveLength(2);
    // Check href of the first link (assuming Link component renders an <a> tag)
    // This depends on how the custom Link component renders. If it's a simple <a>:
    // expect(viewLogsLinks[0]).toHaveAttribute('href', `/agents/${mockAgentId}/docker/id1/logs`);
    // If prependBasePath is used and basePath is empty:
    expect(viewLogsLinks[0]).toHaveAttribute('href', `/agents/${mockAgentId}/docker/id1/logs`);
  });
});
