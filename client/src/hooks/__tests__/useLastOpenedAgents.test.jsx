// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useLastOpenedAgents } from '../useLastOpenedAgents.js';

afterEach(cleanup);

describe('useLastOpenedAgents', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing was recorded for the session', () => {
    const { result } = renderHook(() => useLastOpenedAgents());
    expect(result.current.getLastOpenedAgentId(12)).toBeNull();
  });

  it('returns null without a session id', () => {
    const { result } = renderHook(() => useLastOpenedAgents());
    expect(result.current.getLastOpenedAgentId(null)).toBeNull();
  });

  it('records and returns the last opened agent per session', () => {
    const { result } = renderHook(() => useLastOpenedAgents());
    act(() => {
      result.current.setLastOpenedAgentId(12, 7);
      result.current.setLastOpenedAgentId(13, 9);
    });
    expect(result.current.getLastOpenedAgentId(12)).toBe(7);
    expect(result.current.getLastOpenedAgentId(13)).toBe(9);

    act(() => {
      result.current.setLastOpenedAgentId(12, 8);
    });
    expect(result.current.getLastOpenedAgentId(12)).toBe(8);
    expect(result.current.getLastOpenedAgentId(13)).toBe(9);
  });

  it('persists to localStorage and survives a remount', () => {
    const first = renderHook(() => useLastOpenedAgents());
    act(() => {
      first.result.current.setLastOpenedAgentId(12, 7);
    });
    first.unmount();

    const second = renderHook(() => useLastOpenedAgents());
    expect(second.result.current.getLastOpenedAgentId(12)).toBe(7);
  });

  it('ignores invalid session or agent ids', () => {
    const { result } = renderHook(() => useLastOpenedAgents());
    act(() => {
      result.current.setLastOpenedAgentId(null, 7);
      result.current.setLastOpenedAgentId(12, null);
    });
    expect(localStorage.getItem('session-agents')).toBeNull();
  });

  it('does not rewrite the store when the same agent is recorded again', () => {
    const { result } = renderHook(() => useLastOpenedAgents());
    act(() => {
      result.current.setLastOpenedAgentId(12, 7);
    });
    const snapshot = localStorage.getItem('session-agents');
    act(() => {
      result.current.setLastOpenedAgentId(12, 7);
    });
    expect(localStorage.getItem('session-agents')).toBe(snapshot);
  });
});
