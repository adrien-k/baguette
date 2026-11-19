import { describe, it, expect } from 'vitest';
import {
  MAX_TOOL_RESULT_BYTES,
  spilledResultNotice,
  spillOversizedToolResult,
  spillOversizedRawToolResult,
  spillTextToFile,
  TOOL_RESULTS_DIR,
} from '../mcp/lib/spill-oversized-results.js';
import { ok } from '../mcp/lib/result.js';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function makeBaseDir() {
  return mkdtemp(path.join(tmpdir(), 'spill-'));
}

describe('spillOversizedToolResult', () => {
  it('leaves small results untouched', async () => {
    const baseDir = await makeBaseDir();
    const result = ok({ jobs: [{ log: 'small log' }] });
    expect(await spillOversizedToolResult(result, { baseDir, toolName: 'Test' })).toBe(result);
    const files = await spillDirEmpty(baseDir);
    expect(files).toBe(true);
  });

  it('spills an oversized result and replaces content with a pointer notice', async () => {
    const baseDir = await makeBaseDir();
    const cwd = path.dirname(baseDir);
    const bigLog = 'x'.repeat(MAX_TOOL_RESULT_BYTES + 5000);
    const guarded = await spillOversizedToolResult(ok({ jobs: [{ log: bigLog }] }), {
      baseDir,
      cwd,
      toolName: 'PrWorkflowLogs',
    });
    const text = guarded.content[0].text;
    expect(text).toContain('Full output saved to');
    expect(text).toContain('bytes');
    expect(text).toMatch(/PrWorkflowLogs-[0-9a-f]{12}\.txt/);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(1000);

    const spilledPath = text.match(/saved to (\S+)\.$/m)[1];
    const spilled = await readFile(path.join(cwd, spilledPath), 'utf8');
    expect(spilled).toContain(bigLog);
  });

  it('reuses the same file for identical payloads (content-hash filename)', async () => {
    const baseDir = await makeBaseDir();
    const text = 'y'.repeat(MAX_TOOL_RESULT_BYTES + 10);
    const a = await spillTextToFile(baseDir, 'Test', text);
    const b = await spillTextToFile(baseDir, 'Test', text);
    expect(a.absolutePath).toBe(b.absolutePath);
  });

  it('notes when the spilled result reported an error', async () => {
    const baseDir = await makeBaseDir();
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: false, error: 'x'.repeat(MAX_TOOL_RESULT_BYTES + 10) }),
        },
      ],
    };
    const guarded = await spillOversizedToolResult(result, { baseDir, toolName: 'Test' });
    expect(guarded.content[0].text).toContain('reported an error');
  });

  it('spills oversized raw string tool results for persistence', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'spill-raw-'));
    const big = 'z'.repeat(MAX_TOOL_RESULT_BYTES + 10);
    const guarded = await spillOversizedRawToolResult(big, {
      sessionPath: cwd,
      toolName: 'Test',
    });
    expect(guarded).toMatch(/Tool result too large to include inline/);
  });

  it('builds a notice mentioning chunked reads', () => {
    const notice = spilledResultNotice(`${TOOL_RESULTS_DIR}/x.txt`, 5000);
    expect(notice).toContain(TOOL_RESULTS_DIR);
    expect(notice).toContain('chunks');
  });
});

async function spillDirEmpty(baseDir) {
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(baseDir).catch(() => []);
  return files.length === 0;
}
