import { spawn } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDataDirRelativePath } from '../../config.js';
import { MOCK_AGENT_SUMMARY_TEXT } from '../../../shared/mock-agent-sdk.js';

function parseNonNegativeMs(raw, fallback) {
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return fallback;
}

function mockSleepMs() {
  const raw = process.env.MOCK_AGENT_SLEEP_MS ?? process.env.DUMMY_AGENT_SLEEP_MS;
  return parseNonNegativeMs(raw, 5000);
}

/** Pause between tool completions and before the assistant message (UI pacing). */
function mockStepDelayMs() {
  return parseNonNegativeMs(process.env.MOCK_AGENT_STEP_DELAY_MS, 600);
}

function delay(ms, abortSignal) {
  if (ms <= 0) return Promise.resolve();
  if (abortSignal?.aborted) return Promise.reject(new Error('Aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });
    timer.unref?.();
  });
}

function runShell(cwd, command, abortSignal) {
  if (abortSignal?.aborted) {
    return Promise.reject(new Error('Aborted'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-lc', command], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    const onAbort = () => {
      child.kill('SIGTERM');
      reject(new Error('Aborted'));
    };
    if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
      if (abortSignal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

/**
 * @param {import('../../shared/message-stream-writer.ts').MessageStreamWriter} writer
 */
async function runMockTool(writer, abortSignal, { callId, name, args, rawResult, isError, run }) {
  if (abortSignal?.aborted) throw new Error('Aborted');
  await writer.startTool(callId, name, args);
  let result = rawResult;
  let error = isError;
  if (run) {
    try {
      const out = await run();
      if (out != null && result === undefined) result = out;
    } catch (err) {
      if (err?.message === 'Aborted') throw err;
      error = true;
      result = { content: err?.message ?? 'Tool failed' };
    }
  }
  await writer.completeTool(callId, {
    name,
    args,
    rawResult: result,
    isError: error,
  });
  await delay(mockStepDelayMs(), abortSignal);
}

/**
 * Deterministic dev-only turn exercising every agent tool kind in chat.
 * @param {import('../../shared/message-stream-writer.ts').MessageStreamWriter} writer
 */
export async function runMockAgentTurn({ session, writer, abortSignal }) {
  const cwd = resolveDataDirRelativePath(session.session_path);
  if (!cwd) {
    throw new Error('Session worktree is not ready');
  }

  const mockDir = join(cwd, '.baguette-mock');
  const notesRel = '.baguette-mock/notes.txt';
  const scratchRel = '.baguette-mock/scratch.txt';
  await mkdir(mockDir, { recursive: true });

  const notesInitial = '# Mock agent notes\n\nFirst file from the simulated turn.\n';
  const notesEdited =
    '# Mock agent notes\n\nFirst file from the simulated turn.\n\nEdited in a second step.\n';

  await writer.appendThinking('Simulating a full tool tour for UI and e2e coverage…');
  await writer.flushAssistant();

  await runMockTool(writer, abortSignal, {
    callId: 'mock-todo',
    name: 'TodoWrite',
    args: {
      todos: [
        { content: 'Exercise every tool kind', status: 'completed' },
        { content: 'Finish with assistant summary', status: 'in_progress' },
      ],
    },
    rawResult: { status: 'ok' },
  });

  await runMockTool(writer, abortSignal, {
    callId: 'mock-write-notes',
    name: 'Write',
    args: { file_path: notesRel, content: notesInitial },
    rawResult: { status: 'ok' },
    run: async () => {
      await writeFile(join(cwd, notesRel), notesInitial, 'utf8');
    },
  });

  await runMockTool(writer, abortSignal, {
    callId: 'mock-read-notes',
    name: 'Read',
    args: { file_path: notesRel },
    rawResult: { content: notesInitial },
    run: async () => {
      await readFile(join(cwd, notesRel), 'utf8');
    },
  });

  await runMockTool(writer, abortSignal, {
    callId: 'mock-edit-notes',
    name: 'Edit',
    args: {
      file_path: notesRel,
      old_string: 'First file from the simulated turn.',
      new_string: 'First file from the simulated turn.\n\nEdited in a second step.',
    },
    rawResult: {
      diff: '@@ mock @@\n+Edited in a second step.\n',
    },
    run: async () => {
      await writeFile(join(cwd, notesRel), notesEdited, 'utf8');
    },
  });

  await runMockTool(writer, abortSignal, {
    callId: 'mock-glob',
    name: 'Glob',
    args: { pattern: '**/*.txt', path: '.baguette-mock' },
    rawResult: { matches: [notesRel] },
    run: async () => {
      await runShell(cwd, 'ls -1 .baguette-mock/*.txt 2>/dev/null || true', abortSignal);
    },
  });

  await runMockTool(writer, abortSignal, {
    callId: 'mock-grep',
    name: 'Grep',
    args: { pattern: 'Mock agent', path: notesRel },
    rawResult: { content: `${notesRel}:1:# Mock agent notes` },
    run: async () => {
      await runShell(cwd, `grep -n "Mock agent" "${notesRel}" || true`, abortSignal);
    },
  });

  await runMockTool(writer, abortSignal, {
    callId: 'mock-write-scratch',
    name: 'Write',
    args: { file_path: scratchRel, content: 'temporary\n' },
    rawResult: { status: 'ok' },
    run: async () => {
      await writeFile(join(cwd, scratchRel), 'temporary\n', 'utf8');
    },
  });

  await runMockTool(writer, abortSignal, {
    callId: 'mock-delete-scratch',
    name: 'Delete',
    args: { file_path: scratchRel },
    rawResult: { status: 'ok' },
    run: async () => {
      await unlink(join(cwd, scratchRel)).catch(() => {});
    },
  });

  const sleepSec = mockSleepMs() / 1000;
  const bashCommand = sleepSec > 0 ? `sleep ${sleepSec}` : 'echo mock bash';
  await runMockTool(writer, abortSignal, {
    callId: 'mock-bash',
    name: 'Bash',
    args: { command: bashCommand },
    run: async () => {
      const { stdout, stderr, code } = await runShell(cwd, bashCommand, abortSignal);
      return { exit_code: code, stdout, stderr };
    },
  });

  await runMockTool(writer, abortSignal, {
    callId: 'mock-task',
    name: 'Task',
    args: {
      description: 'Quick explore pass',
      subagent_type: 'explore',
    },
    rawResult: { summary: 'Mock subagent: scanned `.baguette-mock/` (no issues).' },
  });

  await runMockTool(writer, abortSignal, {
    callId: 'mock-ask-user',
    name: 'AskUserQuestion',
    args: {
      questions: [
        {
          question: 'Which mock tool block should we highlight in the screenshot?',
          header: 'Demo',
          options: [
            { label: 'Bash', description: 'Pinned shell dock' },
            { label: 'MCP', description: 'Baguette MCP card' },
          ],
        },
      ],
    },
    rawResult: { status: 'ok' },
  });

  if (abortSignal?.aborted) throw new Error('Aborted');
  await writer.persistPlan(
    '# Mock agent plan\n\n1. Run every canonical tool kind\n2. Emit plan row (not a tool_call)\n3. Summarize in chat\n'
  );
  await delay(mockStepDelayMs(), abortSignal);

  await runMockTool(writer, abortSignal, {
    callId: 'mock-mcp-show-diff',
    name: 'mcp__baguette__ShowDiff',
    args: {
      path: notesRel,
      description: 'Preview notes diff for reviewers',
    },
    rawResult: JSON.stringify({
      ok: true,
      path: notesRel,
      message: 'Mock ShowDiff result',
    }),
  });

  await runMockTool(writer, abortSignal, {
    callId: 'mock-generic',
    name: 'WebFetch',
    args: {
      url: 'https://example.com/mock',
      description: 'Unhandled tool name maps to generic',
    },
    rawResult: '<html>mock fetch</html>',
  });

  await delay(mockStepDelayMs(), abortSignal);
  await writer.appendAssistantText(MOCK_AGENT_SUMMARY_TEXT);
  await writer.flushAssistant();
  await writer.persistTurnResult({
    type: 'turn_result',
    status: 'ok',
    error_message: null,
    total_cost_usd: 0,
  });
}
