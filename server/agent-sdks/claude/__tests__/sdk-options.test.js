import { describe, expect, it, vi } from 'vitest';
import {
  applyClaudeModelParamsToQueryInstance,
  claudeSdkOptionsFromModelParams,
} from '../sdk-options.js';

describe('claudeSdkOptionsFromModelParams', () => {
  it('maps effort, context, and fast params to SDK options', () => {
    const options = claudeSdkOptionsFromModelParams([
      { id: 'effort', value: 'high' },
      { id: 'context', value: '1m' },
      { id: 'fast', value: 'true' },
    ]);
    expect(options).toEqual({
      effort: 'high',
      betas: ['context-1m-2025-08-07'],
      fastMode: true,
    });
  });

  it('returns empty object when params are missing', () => {
    expect(claudeSdkOptionsFromModelParams(null)).toEqual({});
  });

  it('maps every effort level through to options.effort', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(claudeSdkOptionsFromModelParams([{ id: 'effort', value: level }])).toEqual({
        effort: level,
      });
    }
  });

  it('does not emit effort when the param is absent', () => {
    expect(claudeSdkOptionsFromModelParams([{ id: 'fast', value: 'true' }])).toEqual({
      fastMode: true,
    });
  });

  it('ignores Cursor-style reasoning_effort params', () => {
    expect(claudeSdkOptionsFromModelParams([{ id: 'reasoning_effort', value: 'xhigh' }])).toEqual(
      {}
    );
  });
});

describe('applyClaudeModelParamsToQueryInstance', () => {
  it('maps effort to effortLevel flag settings', async () => {
    const applyFlagSettings = vi.fn().mockResolvedValue(undefined);
    await applyClaudeModelParamsToQueryInstance({ applyFlagSettings }, [
      { id: 'effort', value: 'max' },
    ]);
    expect(applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'max' });
  });

  it('maps every effort level through to effortLevel', async () => {
    const applyFlagSettings = vi.fn().mockResolvedValue(undefined);
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      applyFlagSettings.mockClear();
      await applyClaudeModelParamsToQueryInstance({ applyFlagSettings }, [
        { id: 'effort', value: level },
      ]);
      expect(applyFlagSettings).toHaveBeenCalledWith({ effortLevel: level });
    }
  });

  it('passes effort and fast mode together', async () => {
    const applyFlagSettings = vi.fn().mockResolvedValue(undefined);
    await applyClaudeModelParamsToQueryInstance({ applyFlagSettings }, [
      { id: 'effort', value: 'low' },
      { id: 'fast', value: 'true' },
    ]);
    expect(applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'low', fastMode: true });
  });

  it('accepts JSON-string model params', async () => {
    const applyFlagSettings = vi.fn().mockResolvedValue(undefined);
    await applyClaudeModelParamsToQueryInstance(
      { applyFlagSettings },
      '[{"id":"effort","value":"high"}]'
    );
    expect(applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'high' });
  });

  it('does not call applyFlagSettings without effort or fast params', async () => {
    const applyFlagSettings = vi.fn().mockResolvedValue(undefined);
    await applyClaudeModelParamsToQueryInstance({ applyFlagSettings }, [
      { id: 'context', value: '1m' },
    ]);
    expect(applyFlagSettings).not.toHaveBeenCalled();
  });

  it('is a no-op when the query instance lacks applyFlagSettings', async () => {
    await expect(
      applyClaudeModelParamsToQueryInstance({}, [{ id: 'effort', value: 'high' }])
    ).resolves.toBeUndefined();
    await expect(
      applyClaudeModelParamsToQueryInstance(null, [{ id: 'effort', value: 'high' }])
    ).resolves.toBeUndefined();
  });
});
