import { describe, it, expect, vi, beforeEach } from 'vitest';

const listCursorModels = vi.hoisted(() => vi.fn());
const refreshCursorModels = vi.hoisted(() => vi.fn());

vi.mock('../models.js', () => ({
  listCursorModels,
  refreshCursorModels,
}));

import { cursorAgentSdkPlugin } from '../index.js';

beforeEach(() => {
  listCursorModels.mockReset();
  refreshCursorModels.mockReset();
});

describe('cursorAgentSdkPlugin.listModels', () => {
  it('awaits async model helpers so models is an array, not a Promise', async () => {
    listCursorModels.mockResolvedValue([{ id: 'gpt-5', displayName: 'GPT-5' }]);
    const result = await cursorAgentSdkPlugin.listModels({ api_key: 'cursor-key' });
    expect(result.models).toEqual([{ id: 'gpt-5', displayName: 'GPT-5' }]);
    expect(result.rejected_models).toEqual([]);
    expect(result.models).not.toBeInstanceOf(Promise);
  });

  it('awaits refreshCursorModels when refresh is true', async () => {
    refreshCursorModels.mockResolvedValue([{ id: 'composer-1', displayName: 'Composer' }]);
    const result = await cursorAgentSdkPlugin.listModels(
      { api_key: 'cursor-key' },
      { refresh: true }
    );
    expect(refreshCursorModels).toHaveBeenCalledWith('cursor-key');
    expect(listCursorModels).not.toHaveBeenCalled();
    expect(result.models).toEqual([{ id: 'composer-1', displayName: 'Composer' }]);
  });

  it('propagates refresh failures from refreshCursorModels', async () => {
    refreshCursorModels.mockRejectedValue(new Error('Cursor API unavailable'));
    await expect(
      cursorAgentSdkPlugin.listModels({ api_key: 'cursor-key' }, { refresh: true })
    ).rejects.toThrow('Cursor API unavailable');
  });
});
