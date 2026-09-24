import { describe, it, expect } from 'vitest';
import {
  sliceByteRange,
  resolveByteRange,
  buildLogRangeHeader,
  validateLogByteRange,
  DEFAULT_LOG_BYTES,
  MAX_LOG_RANGE_BYTES,
} from '../mcp-pagination.js';

describe('validateLogByteRange', () => {
  it('rejects negative startByte with non-negative endByte', () => {
    expect(validateLogByteRange({ startByte: -10, endByte: 100 })).toMatch(/negative startByte/i);
  });

  it('allows negative start and end', () => {
    expect(validateLogByteRange({ startByte: -20, endByte: -1 })).toBeNull();
  });
});

describe('resolveByteRange', () => {
  it('defaults to the last 5000 bytes', () => {
    expect(resolveByteRange(10_000)).toEqual({ start: 5000, end: 9999 });
  });

  it('with only startByte, spans max(5000, remaining) through EOF', () => {
    expect(resolveByteRange(10_000, { startByte: 0 })).toEqual({ start: 0, end: 9999 });
    expect(resolveByteRange(3000, { startByte: 0 })).toEqual({ start: 0, end: 2999 });
    expect(resolveByteRange(10_000, { startByte: 8000 })).toEqual({ start: 8000, end: 9999 });
  });

  it('caps explicit start and end at 5000 bytes', () => {
    expect(resolveByteRange(20_000, { startByte: 0, endByte: 19_999 })).toEqual({
      start: 0,
      end: 4999,
    });
  });

  it('negative start and negative end stay within explicit cap', () => {
    expect(resolveByteRange(100, { startByte: -50, endByte: -1 })).toEqual({ start: 50, end: 99 });
    expect(resolveByteRange(10_000, { startByte: -6000, endByte: -1 })).toEqual({
      start: 4000,
      end: 8999,
    });
  });

  it('returns zero range for empty output', () => {
    expect(resolveByteRange(0)).toEqual({ start: 0, end: 0 });
  });
});

describe('sliceByteRange', () => {
  it('throws on invalid start/end sign mix', () => {
    expect(() => sliceByteRange('log', { startByte: -1, endByte: 0 })).toThrow(
      /negative startByte/i
    );
  });

  it('returns the last 10 bytes when startByte is -10 and endByte is -1', () => {
    const suffix = '0123456789';
    const text = `${'a'.repeat(90)}${suffix}`;
    const result = sliceByteRange(text, { startByte: -10, endByte: -1 });
    expect(result.log).toBe(suffix);
  });

  it('returns the last default bytes when no range is given', () => {
    const text = 'x'.repeat(20_000);
    const result = sliceByteRange(text);
    expect(result.log.length).toBe(DEFAULT_LOG_BYTES);
    expect(result.startByte).toBe(20_000 - DEFAULT_LOG_BYTES);
  });

  it('honours an inclusive endByte with explicit cap', () => {
    const result = sliceByteRange('hello', { startByte: 1, endByte: 3 });
    expect(result.log).toBe('ell');
  });
});

describe('buildLogRangeHeader', () => {
  it('defaults to the last 5000 bytes', () => {
    expect(buildLogRangeHeader({})).toBe(`bytes=-${DEFAULT_LOG_BYTES}`);
  });

  it('requests a full log when endByte is omitted with startByte', () => {
    expect(buildLogRangeHeader({ startByte: 0 })).toBe('bytes=0-');
    expect(buildLogRangeHeader({ startByte: -10 })).toBe('bytes=0-');
  });

  it('uses closed range when start and end are set', () => {
    expect(buildLogRangeHeader({ startByte: 0, endByte: 7999 })).toBe('bytes=0-4999');
  });

  it('requests a full log when endByte is negative', () => {
    expect(buildLogRangeHeader({ startByte: 0, endByte: -10 })).toBe('bytes=0-');
  });
});
