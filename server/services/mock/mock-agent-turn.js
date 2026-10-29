import { spawn } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDataDirRelativePath } from '../../config.js';
import {
  mockAgentFullTurnClosingMessage,
  MOCK_E2E_QUICK_TURN_PROMPT,
  MOCK_E2E_QUICK_TURN_SUMMARY,
  MOCK_E2E_SUBAGENT_NAME,
  MOCK_E2E_SUBAGENT_PRESET_DESCRIPTION,
  MOCK_E2E_SUBAGENT_SUMMARY,
  MOCK_E2E_ASK_ANSWER_SUMMARY,
  MOCK_E2E_ASK_QUESTION_TEXT,
  MOCK_E2E_PLAN_MARKDOWN,
  MOCK_E2E_PLAN_NON_INTERACTIVE_MARKDOWN,
  MOCK_E2E_PLAN_NON_INTERACTIVE_SUMMARY,
  MOCK_E2E_PLAN_RUN_SUMMARY,
  MOCK_REVIEW_ISSUES,
  MOCK_REVIEWER_SUMMARY_TEXT,
  mockAgentScenarioForPrompt,
} from '../../../shared/mock-agent-sdk.js';
import {
  SUBAGENT_DEFAULT_PRESET,
  normalizeSubagentDefaultMode,
} from '../../../shared/subagent-default-mode.js';
import { resolveEffectiveSubagentDefaultSettings } from '../agent-config-resolver.js';

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
 * @param {import('../../shared/message-stream-writer.ts').MessageStreamWriter} writer
 */
async function runMockQuickTurn({ writer, abortSignal }) {
  await writer.appendThinking('E2E quick mock turn…');
  await delay(mockStepDelayMs(), abortSignal);
  await writer.appendAssistantText(MOCK_E2E_QUICK_TURN_SUMMARY);
  await writer.flushAssistant();
  await writer.persistTurnResult({
    type: 'turn_result',
    status: 'ok',
    error_message: null,
    total_cost_usd: 0,
  });
  return {};
}

const MOCK_E2E_ASK_OPTIONS = [
  { label: 'Plan flow', description: 'Exercise CreatePlan UI' },
  { label: 'Ask flow', description: 'Exercise AskUserQuestions UI' },
];

/**
 * @param {import('../../shared/message-stream-writer.ts').MessageStreamWriter} writer
 */
async function runMockPlanCreateTurn({ writer, abortSignal }) {
  await runMockTool(writer, abortSignal, {
    callId: 'mock-e2e-create-plan',
    name: 'mcp__baguette__CreatePlan',
    args: { markdown: MOCK_E2E_PLAN_MARKDOWN, interactive: true },
    rawResult: JSON.stringify({ ok: true, markdown: MOCK_E2E_PLAN_MARKDOWN }),
  });
  await writer.persistTurnResult({
    type: 'turn_result',
    status: 'ok',
    error_message: null,
    total_cost_usd: 0,
  });
  return { awaitingUser: true };
}

/**
 * @param {import('../../shared/message-stream-writer.ts').MessageStreamWriter} writer
 */
async function runMockPlanCreateNonInteractiveTurn({ writer, abortSignal }) {
  await runMockTool(writer, abortSignal, {
    callId: 'mock-e2e-create-plan-non-interactive',
    name: 'mcp__baguette__CreatePlan',
    args: {
      markdown: MOCK_E2E_PLAN_NON_INTERACTIVE_MARKDOWN,
      interactive: false,
    },
    rawResult: JSON.stringify({
      ok: true,
      markdown: MOCK_E2E_PLAN_NON_INTERACTIVE_MARKDOWN,
    }),
  });
  await runMockTool(writer, abortSignal, {
    callId: 'mock-e2e-todo-after-non-interactive-plan',
    name: 'mcp__baguette__CreateTodo',
    args: {
      title: 'E2E orchestration step',
      content: 'Mock todo created in the same turn after a non-interactive plan.',
    },
    rawResult: JSON.stringify({
      ok: true,
      todo: { ref: 1, title: 'E2E orchestration step', status: 'pending' },
    }),
  });
  await writer.appendAssistantText(MOCK_E2E_PLAN_NON_INTERACTIVE_SUMMARY);
  await writer.flushAssistant();
  await writer.persistTurnResult({
    type: 'turn_result',
    status: 'ok',
    error_message: null,
    total_cost_usd: 0,
  });
  return {};
}

/**
 * @param {import('../../shared/message-stream-writer.ts').MessageStreamWriter} writer
 */
async function runMockPlanRunTurn({ writer }) {
  await writer.appendAssistantText(MOCK_E2E_PLAN_RUN_SUMMARY);
  await writer.flushAssistant();
  await writer.persistTurnResult({
    type: 'turn_result',
    status: 'ok',
    error_message: null,
    total_cost_usd: 0,
  });
  return {};
}

/**
 * @param {import('../../shared/message-stream-writer.ts').MessageStreamWriter} writer
 */
async function runMockAskQuestionTurn({ writer, abortSignal }) {
  const questions = [
    {
      question: MOCK_E2E_ASK_QUESTION_TEXT,
      options: MOCK_E2E_ASK_OPTIONS,
    },
  ];
  await runMockTool(writer, abortSignal, {
    callId: 'mock-e2e-ask-user',
    name: 'mcp__baguette__AskUserQuestions',
    args: { questions },
    rawResult: JSON.stringify({ ok: true, questions }),
  });
  await writer.persistTurnResult({
    type: 'turn_result',
    status: 'ok',
    error_message: null,
    total_cost_usd: 0,
  });
  return { awaitingUser: true };
}

/**
 * @param {import('../../shared/message-stream-writer.ts').MessageStreamWriter} writer
 */
async function runMockAskAnswerTurn({ writer }) {
  await writer.appendAssistantText(MOCK_E2E_ASK_ANSWER_SUMMARY);
  await writer.flushAssistant();
  await writer.persistTurnResult({
    type: 'turn_result',
    status: 'ok',
    error_message: null,
    total_cost_usd: 0,
  });
  return {};
}

/**
 * Primary builder turn: real StartSubagent (MCP flag) for e2e session-agent coverage.
 * @param {import('../../shared/message-stream-writer.ts').MessageStreamWriter} writer
 */
async function runMockSubagentE2eTurn({ app, session, userId, writer, abortSignal, turnId }) {
  await writer.appendThinking('Calling StartSubagent for e2e…');
  await delay(mockStepDelayMs(), abortSignal);

  const callId =
    turnId != null ? `mock-mcp-start-subagent-${turnId}` : `mock-mcp-start-subagent-${Date.now()}`;
  const toolArgs = {
    name: MOCK_E2E_SUBAGENT_NAME,
    initial_prompt: MOCK_E2E_QUICK_TURN_PROMPT,
  };
  await writer.startTool(callId, 'mcp__baguette__StartSubagent', toolArgs);
  try {
    const db = app.get('db');
    const settings = await resolveEffectiveSubagentDefaultSettings(db, userId);
    const mode = normalizeSubagentDefaultMode(settings.mode);
    let preset_model_id;
    if (mode === SUBAGENT_DEFAULT_PRESET) {
      const preset = await db('agent_model_presets')
        .where({ user_id: userId })
        .where('description', 'like', `%${MOCK_E2E_SUBAGENT_PRESET_DESCRIPTION}%`)
        .orderBy('id', 'asc')
        .first();
      if (!preset) {
        throw new Error('No e2e subagent preset configured');
      }
      preset_model_id = preset.id;
    }
    const parentAgent = await db('agents').where({ session_id: session.id, is_primary: 1 }).first();
    const result = await app.service('agents').startSubagent(
      {
        session_id: session.id,
        name: MOCK_E2E_SUBAGENT_NAME,
        initial_prompt: MOCK_E2E_QUICK_TURN_PROMPT,
        wait_for_completion: false,
        ...(parentAgent?.id != null ? { parent_agent_id: parentAgent.id } : {}),
        ...(preset_model_id != null ? { preset_model_id } : {}),
      },
      { user: { id: userId }, provider: 'rest' }
    );
    await writer.completeTool(callId, {
      name: 'mcp__baguette__StartSubagent',
      args: toolArgs,
      rawResult: JSON.stringify({
        ok: true,
        agent_id: result.agent_id,
        ref: result.ref,
        status: result.status,
        session_id: result.session_id,
      }),
      isError: false,
    });
  } catch (err) {
    if (err?.message === 'Aborted') throw err;
    await writer.completeTool(callId, {
      name: 'mcp__baguette__StartSubagent',
      args: toolArgs,
      rawResult: { content: err?.message ?? 'StartSubagent failed' },
      isError: true,
    });
    throw err;
  }
  await delay(mockStepDelayMs(), abortSignal);

  await writer.appendAssistantText(MOCK_E2E_SUBAGENT_SUMMARY);
  await writer.flushAssistant();
  await writer.persistTurnResult({
    type: 'turn_result',
    status: 'ok',
    error_message: null,
    total_cost_usd: 0,
  });
  return {};
}

/**
 * Deterministic dev-only turn exercising every agent tool kind in chat.
 * @param {import('../../shared/message-stream-writer.ts').MessageStreamWriter} writer
 * @returns {Promise<{ awaitingUser?: boolean }>}
 */
export async function runMockAgentTurn({
  session,
  writer,
  abortSignal,
  userPrompt = '',
  app,
  userId,
  turnId = null,
}) {
  const scenario = mockAgentScenarioForPrompt(userPrompt);
  if (scenario === 'quick') {
    return runMockQuickTurn({ writer, abortSignal });
  }
  if (scenario === 'subagent-e2e') {
    if (!app || userId == null) {
      throw new Error('subagent-e2e mock turn requires app and userId');
    }
    return runMockSubagentE2eTurn({ app, session, userId, writer, abortSignal, turnId });
  }
  if (scenario === 'plan-create') {
    return runMockPlanCreateTurn({ writer, abortSignal });
  }
  if (scenario === 'plan-create-non-interactive') {
    return runMockPlanCreateNonInteractiveTurn({ writer, abortSignal });
  }
  if (scenario === 'plan-run') {
    return runMockPlanRunTurn({ writer, abortSignal });
  }
  if (scenario === 'ask-question') {
    return runMockAskQuestionTurn({ writer, abortSignal });
  }
  if (scenario === 'ask-answer') {
    return runMockAskAnswerTurn({ writer, abortSignal });
  }

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
    callId: 'mock-mcp-config-repo',
    name: 'mcp__baguette__ConfigRepoPrompt',
    args: {},
    rawResult: JSON.stringify({
      ok: true,
      prompt: 'Mock config repo prompt snippet',
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
  await writer.appendAssistantText(mockAgentFullTurnClosingMessage());
  await writer.flushAssistant();
  await writer.persistTurnResult({
    type: 'turn_result',
    status: 'ok',
    error_message: null,
    total_cost_usd: 0,
  });
  return {};
}

/**
 * Deterministic dev-only reviewer turn: CreateIssue-style MCP tools + summary.
 * @param {import('../../shared/message-stream-writer.ts').MessageStreamWriter} writer
 * @param {(spec: { severity: string, title: string, description: string }) => Promise<unknown>} createIssue
 */
export async function runMockReviewerTurn({ writer, abortSignal, createIssue }) {
  await writer.appendThinking('Simulating reviewer findings for the Issues tab…');
  await writer.flushAssistant();
  await delay(mockStepDelayMs(), abortSignal);

  let ref = 0;
  for (const spec of MOCK_REVIEW_ISSUES) {
    ref += 1;
    await runMockTool(writer, abortSignal, {
      callId: `mock-create-issue-${ref}`,
      name: 'mcp__baguette__CreateIssue',
      args: {
        severity: spec.severity,
        title: spec.title,
        description: spec.description,
      },
      run: async () => {
        const issue = await createIssue(spec);
        return JSON.stringify({ ok: true, issue });
      },
    });
  }

  await delay(mockStepDelayMs(), abortSignal);
  await writer.appendAssistantText(MOCK_REVIEWER_SUMMARY_TEXT);
  await writer.flushAssistant();
  await writer.persistTurnResult({
    type: 'turn_result',
    status: 'ok',
    error_message: null,
    total_cost_usd: 0,
  });
}
