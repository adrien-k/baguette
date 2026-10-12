import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  getBundledLunaroutePiExtensionPath,
  lunaroutePiAdditionalExtensionPaths,
} from '../pi-lunaroute-extension-path.js';

describe('getBundledLunaroutePiExtensionPath', () => {
  it('points at the in-repo chat-only extension entry', () => {
    const entry = getBundledLunaroutePiExtensionPath();
    expect(existsSync(entry)).toBe(true);
    expect(entry).toMatch(/lunaroute-chat[/\\]index\.ts$/);
  });
});

describe('lunaroutePiAdditionalExtensionPaths', () => {
  it('returns the extension only for LUNAROUTE_API_KEY', () => {
    expect(lunaroutePiAdditionalExtensionPaths('LUNAROUTE_API_KEY')).toHaveLength(1);
    expect(lunaroutePiAdditionalExtensionPaths('ANTHROPIC_API_KEY')).toEqual([]);
    expect(lunaroutePiAdditionalExtensionPaths('OPENAI_API_KEY')).toEqual([]);
  });
});
