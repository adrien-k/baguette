import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeMcpParamsForPi, parsePiToolParams } from '../pi-tool-params.js';

describe('normalizeMcpParamsForPi', () => {
  it('maps 8-char session_id to short_id', () => {
    expect(normalizeMcpParamsForPi({ session_id: 'abf629e7' })).toEqual({
      short_id: 'abf629e7',
    });
  });

  it('coerces numeric session_id strings', () => {
    expect(normalizeMcpParamsForPi({ session_id: '32' })).toEqual({ session_id: 32 });
  });

  it('coerces message_id', () => {
    expect(normalizeMcpParamsForPi({ message_id: '99' })).toEqual({ message_id: 99 });
  });
});

describe('parsePiToolParams', () => {
  const getSessionShape = {
    session_id: z.number().int().optional(),
    short_id: z.string().optional(),
  };

  it('accepts short_id via misnamed session_id', () => {
    const parsed = parsePiToolParams(getSessionShape, { session_id: 'abf629e7' });
    expect(parsed).toEqual({ short_id: 'abf629e7' });
  });

  it('accepts numeric session_id as string', () => {
    const parsed = parsePiToolParams(getSessionShape, { session_id: '32' });
    expect(parsed).toEqual({ session_id: 32 });
  });
});
