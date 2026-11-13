import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeMcpParamsForPi, parsePiToolParams } from '../pi-tool-params.js';

describe('normalizeMcpParamsForPi', () => {
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
  };

  it('accepts numeric session_id as string', () => {
    const parsed = parsePiToolParams(getSessionShape, { session_id: '32' });
    expect(parsed).toEqual({ session_id: 32 });
  });
});
