import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { buildAntigravityEnv, parseExtraEnvJson, resolveAgyBinary } from '../env.js';

describe('antigravity env helpers', () => {
  it('parseExtraEnvJson handles objects, JSON strings, invalid JSON, and nullish values', () => {
    expect(parseExtraEnvJson(null)).toEqual({});
    expect(parseExtraEnvJson('')).toEqual({});
    expect(parseExtraEnvJson('not-json')).toEqual({});
    expect(parseExtraEnvJson(['a'])).toEqual({});
    expect(parseExtraEnvJson('{"FOO":"bar","NUM":42,"EMPTY":null}')).toEqual({
      FOO: 'bar',
      NUM: '42',
    });
    expect(parseExtraEnvJson({ '  CUSTOM  ': 'val' })).toEqual({ CUSTOM: 'val' });
  });

  it('resolveAgyBinary prefers explicit overrides, skips broken symlinks, and checks PATH/home', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baguette-agy-bin-'));
    try {
      const brokenLink = path.join(tmpDir, 'broken-agy');
      fs.symlinkSync(path.join(tmpDir, 'nonexistent'), brokenLink);

      const goodBin = path.join(tmpDir, 'good-agy');
      fs.writeFileSync(goodBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

      const resolved = resolveAgyBinary(
        { ANTIGRAVITY_BIN: brokenLink, AGY_BIN: goodBin },
        { env: { PATH: '' }, homedir: tmpDir }
      );
      expect(resolved).toBe(goodBin);

      const fallbackDir = path.join(tmpDir, '.gemini', 'bin');
      fs.mkdirSync(fallbackDir, { recursive: true });
      const homeBin = path.join(fallbackDir, 'agy');
      fs.writeFileSync(homeBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

      const fromHome = resolveAgyBinary({}, { env: { PATH: '' }, homedir: tmpDir });
      expect(fromHome).toBe(homeBin);

      const defaultFallback = resolveAgyBinary(
        {},
        {
          env: { PATH: '' },
          homedir: path.join(tmpDir, 'missing-home'),
          fsImpl: {
            constants: fs.constants,
            accessSync() {
              throw new Error('ENOENT');
            },
            statSync() {
              throw new Error('ENOENT');
            },
          },
        }
      );
      expect(defaultFallback).toBe('agy');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('buildAntigravityEnv merges extra_env_json, optional GEMINI_API_KEY, and git user identity', () => {
    const env = buildAntigravityEnv(
      {
        api_key: '  gm-secret  ',
        extra_env_json: JSON.stringify({ ANTIGRAVITY_BIN: '/custom/agy' }),
      },
      { username: 'ada', email: 'ada@example.com' }
    );
    expect(env.ANTIGRAVITY_BIN).toBe('/custom/agy');
    expect(env.GEMINI_API_KEY).toBe('gm-secret');
    expect(env.GIT_AUTHOR_NAME).toBe('ada');
    expect(env.GIT_AUTHOR_EMAIL).toBe('ada@example.com');
  });

  it('buildAntigravityEnv strips GEMINI_API_KEY from host env and extra_env_json when api_key is unset', () => {
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'host-key';
    try {
      const envFromHost = buildAntigravityEnv({ api_key: null, extra_env_json: null });
      expect(envFromHost.GEMINI_API_KEY).toBeUndefined();

      const envFromExtra = buildAntigravityEnv({
        api_key: '',
        extra_env_json: JSON.stringify({
          GEMINI_API_KEY: 'extra-key',
          ANTIGRAVITY_BIN: '/custom/agy',
        }),
      });
      expect(envFromExtra.GEMINI_API_KEY).toBeUndefined();
      expect(envFromExtra.ANTIGRAVITY_BIN).toBe('/custom/agy');
    } finally {
      if (prev === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = prev;
      }
    }
  });
});
