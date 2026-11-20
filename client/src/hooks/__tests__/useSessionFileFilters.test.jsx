// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useSessionFileFilters } from '../useSessionFileFilters.js';

afterEach(cleanup);

describe('useSessionFileFilters', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty patterns', () => {
    const { result } = renderHook(() => useSessionFileFilters());
    expect(result.current.includePattern).toBe('');
    expect(result.current.excludePattern).toBe('');
    expect(result.current.compiled.active).toBe(false);
  });

  it('persists patterns to localStorage', () => {
    const { result } = renderHook(() => useSessionFileFilters());
    act(() => {
      result.current.setIncludePattern('\\.md$');
      result.current.setExcludePattern('node_modules');
    });
    expect(JSON.parse(localStorage.getItem('session-file-filters'))).toEqual({
      includePattern: '\\.md$',
      excludePattern: 'node_modules',
    });
  });

  it('restores patterns after remount', () => {
    const first = renderHook(() => useSessionFileFilters());
    act(() => {
      first.result.current.setIncludePattern('client/');
    });
    first.unmount();

    const second = renderHook(() => useSessionFileFilters());
    expect(second.result.current.includePattern).toBe('client/');
    expect(second.result.current.compiled.active).toBe(true);
  });

  it('clear removes persisted filters', () => {
    const { result } = renderHook(() => useSessionFileFilters());
    act(() => {
      result.current.setIncludePattern('src/');
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.includePattern).toBe('');
    expect(localStorage.getItem('session-file-filters')).toBeNull();
  });
});
