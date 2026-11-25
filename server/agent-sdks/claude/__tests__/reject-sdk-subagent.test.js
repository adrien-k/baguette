import { describe, it, expect } from 'vitest';

import { ClaudeDriver } from '../driver.ts';
import {
  CLAUDE_SDK_SUBAGENT_DENIED_MESSAGE,
  claudeSdkSubagentDenyResult,
  isClaudeSdkSubagentTool,
} from '../reject-sdk-subagent.js';

describe('reject-sdk-subagent', () => {
  it('matches Agent and Task only', () => {
    expect(isClaudeSdkSubagentTool('Agent')).toBe(true);
    expect(isClaudeSdkSubagentTool('Task')).toBe(true);
    expect(isClaudeSdkSubagentTool('TaskCreate')).toBe(false);
    expect(isClaudeSdkSubagentTool('Bash')).toBe(false);
  });

  it('returns a deny payload with StartSubagent hint', () => {
    const deny = claudeSdkSubagentDenyResult('Task');
    expect(deny).toEqual({
      behavior: 'deny',
      message: CLAUDE_SDK_SUBAGENT_DENIED_MESSAGE,
    });
    expect(CLAUDE_SDK_SUBAGENT_DENIED_MESSAGE).toContain('StartSubagent');
  });

  it('createCanUseTool denies SDK subagent tools', async () => {
    const driver = new ClaudeDriver({}, null);
    const canUseTool = driver.createCanUseTool();

    const denied = await canUseTool('Agent', { prompt: 'explore' });
    expect(denied).toEqual({
      behavior: 'deny',
      message: CLAUDE_SDK_SUBAGENT_DENIED_MESSAGE,
    });

    const allowed = await canUseTool('Bash', { command: 'ls' });
    expect(allowed).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
  });
});
