// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const getBranchesMock = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useGetBranches.js', () => ({
  useGetBranches: (repo) => getBranchesMock(repo),
}));

import RepoFixedPushBranchesControl from '../RepoFixedPushBranchesControl.jsx';

const baseRepo = {
  id: 42,
  full_name: 'acme/app',
  default_branch: 'main',
  agent_fixed_push_branches: [],
};

function setupBranchesHook(overrides = {}) {
  const clearCacheAndReload = vi.fn().mockResolvedValue(undefined);
  getBranchesMock.mockImplementation((repo) => {
    if (!repo) {
      return { branches: [], loading: false, clearCacheAndReload, clearingCache: false };
    }
    return {
      branches: ['main', 'development', 'staging'],
      loading: false,
      clearCacheAndReload,
      clearingCache: false,
      ...overrides,
    };
  });
  return { clearCacheAndReload };
}

afterEach(() => {
  cleanup();
  getBranchesMock.mockReset();
});

describe('RepoFixedPushBranchesControl', () => {
  it('fetches repository branches lazily only when the picker is opened', () => {
    setupBranchesHook();
    render(<RepoFixedPushBranchesControl repo={baseRepo} onSave={vi.fn()} />);

    expect(getBranchesMock).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: /Add branch/i }));
    expect(getBranchesMock).toHaveBeenLastCalledWith(baseRepo);
    expect(screen.getByRole('option', { name: /main/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /development/i })).toBeTruthy();
    expect(screen.getByText('default')).toBeTruthy();
  });

  it('renders configured branches as chips and removes one when its remove button is clicked', async () => {
    setupBranchesHook();
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <RepoFixedPushBranchesControl
        repo={{ ...baseRepo, agent_fixed_push_branches: ['development', 'staging'] }}
        onSave={onSave}
      />
    );

    expect(screen.getByText('development')).toBeTruthy();
    expect(screen.getByText('staging')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove branch development' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), ['staging']);
    });
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('toggles repository branches from the dropdown', async () => {
    setupBranchesHook();
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <RepoFixedPushBranchesControl
        repo={{ ...baseRepo, agent_fixed_push_branches: ['development'] }}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Add branch/i }));
    fireEvent.click(screen.getByRole('option', { name: /staging/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), [
        'development',
        'staging',
      ]);
    });
  });

  it('filters branches and adds a custom branch via click or Enter', async () => {
    setupBranchesHook();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<RepoFixedPushBranchesControl repo={baseRepo} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: /Add branch/i }));
    const input = screen.getByLabelText('Search or type branch name');

    fireEvent.change(input, { target: { value: 'release/v2' } });
    expect(screen.queryByRole('option', { name: /main/i })).toBeNull();
    expect(screen.getByText(/Add “release\/v2”/)).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), ['release/v2']);
    });
    expect(input.value).toBe('');
  });

  it('supports refreshing branches and clearing all configured branches', async () => {
    const { clearCacheAndReload } = setupBranchesHook();
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <RepoFixedPushBranchesControl
        repo={{ ...baseRepo, agent_fixed_push_branches: ['development', 'custom-only'] }}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Add branch/i }));
    expect(screen.getByText('custom')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh branches' }));
    expect(clearCacheAndReload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), []);
    });
  });
});
