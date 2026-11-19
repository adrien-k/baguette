import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  compactOversizedToolCallPayload,
  compactOversizedToolCallMessages,
} from '../mcp/lib/compact-oversized-tool-messages.js';
import { MAX_TOOL_RESULT_BYTES } from '../mcp/lib/spill-oversized-results.js';

describe('compactOversizedToolCallPayload', () => {
  it('replaces oversized mcp content with a spill notice', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'compact-mcp-'));
    const big = 'l'.repeat(MAX_TOOL_RESULT_BYTES + 50);
    const next = await compactOversizedToolCallPayload(
      {
        type: 'tool_call',
        id: 'c1',
        name: 'mcp__baguette__pr_workflow_logs',
        kind: 'mcp',
        status: 'completed',
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:00:01.000Z',
        args: { tool: 'PrWorkflowLogs' },
        result: { status: 'ok', content: big, data: { ok: true } },
      },
      { sessionPath: cwd }
    );
    expect(next?.result.content).toMatch(/Tool result too large to include inline/);
    expect(next?.result.data).toBeNull();
    const match = next.result.content.match(/saved to (\S+)\./);
    const spilled = await readFile(path.join(cwd, match[1]), 'utf8');
    expect(spilled).toBe(big);
  });
});

describe('compactOversizedToolCallMessages', () => {
  it('patches oversized tool_call rows in the database', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'compact-db-'));
    const big = 'x'.repeat(MAX_TOOL_RESULT_BYTES + 1);
    const rows = [
      {
        id: 9,
        message_json: JSON.stringify({
          type: 'tool_call',
          id: 'c1',
          name: 'PrWorkflowLogs',
          kind: 'mcp',
          status: 'completed',
          started_at: '2026-01-01T00:00:00.000Z',
          ended_at: '2026-01-01T00:00:01.000Z',
          args: { tool: 'PrWorkflowLogs' },
          result: { status: 'ok', content: big },
        }),
      },
    ];
    const patch = vi.fn();
    const db = () => ({
      where: () => ({
        whereNotNull: () => ({
          select: async () => rows,
        }),
      }),
    });
    const app = {
      get: (key) => (key === 'db' ? db : undefined),
      service: () => ({ patch }),
    };

    await compactOversizedToolCallMessages(app, {
      sessionId: 1,
      userId: 2,
      sessionPath: cwd,
    });

    expect(patch).toHaveBeenCalledOnce();
    const patched = JSON.parse(patch.mock.calls[0][1].message_json);
    expect(patched.result.content).toMatch(/Tool result too large to include inline/);
  });
});
