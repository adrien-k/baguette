import { describe, it, expect } from 'vitest';
import { formatTurnErrorMessage } from '../format-turn-error-message.js';

describe('formatTurnErrorMessage', () => {
  it('formats LunaRoute gateway errors with JSON bodies', () => {
    const raw = 'lunaroute API error (502): {"message":"bad gateway","type":"502"}';
    expect(formatTurnErrorMessage(raw)).toEqual({
      headline: 'LunaRoute API error (502 Bad Gateway)',
      detail: null,
      raw,
    });
  });

  it('keeps distinct API error detail when it adds context', () => {
    const raw = 'lunaroute API error (402): {"message":"Insufficient account funds","type":"402"}';
    expect(formatTurnErrorMessage(raw)).toEqual({
      headline: 'LunaRoute API error (402 Payment Required)',
      detail: 'Insufficient account funds',
      raw,
    });
  });

  it('formats numeric prefix errors', () => {
    const raw = '402: Insufficient account funds';
    expect(formatTurnErrorMessage(raw)).toEqual({
      headline: '402 Payment Required',
      detail: 'Insufficient account funds',
      raw,
    });
  });

  it('passes through plain messages', () => {
    const raw = 'LunaRoute init failed';
    expect(formatTurnErrorMessage(raw)).toEqual({
      headline: raw,
      detail: null,
      raw,
    });
  });
});
