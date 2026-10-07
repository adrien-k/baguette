import {
  CLAUDE_AGENT_SDK_KEY,
  CLAUDE_AGENT_SDK_LABEL,
  CLAUDE_AGENT_SERVICE_PATH,
} from '../services/agent-sdk/claude-agent-sdk.js';
import {
  CURSOR_AGENT_SDK_KEY,
  CURSOR_AGENT_SDK_LABEL,
  CURSOR_AGENT_SERVICE_PATH,
} from '../services/agent-sdk/cursor-agent-sdk.js';
import {
  registerAgentSdk,
  registerAgentSdksService,
} from '../services/feathers/agent-sdks.service.js';

/** Mount `agent-sdks` when the test app does not already have it. */
export function mountAgentSdks(app) {
  if (!app.services?.['agent-sdks']) {
    registerAgentSdksService(app);
  }
}

function useAgentServiceStub(app, { key, label, servicePath }, service, methods) {
  mountAgentSdks(app);
  const stub = {
    async isEnabled() {
      return true;
    },
    async listModels() {
      return [];
    },
    async isInterruptedSessionResumable(session, { channel = 'chat' } = {}) {
      if (key === CURSOR_AGENT_SDK_KEY) {
        return channel === 'review'
          ? Boolean(session?.review_cursor_agent_id)
          : Boolean(session?.cursor_agent_id);
      }
      return channel === 'review'
        ? Boolean(session?.review_claude_session_id)
        : Boolean(session?.claude_session_id);
    },
    usesCompactionBeforeLoopRepeat() {
      return key !== CURSOR_AGENT_SDK_KEY;
    },
    ...service,
  };
  const methodNames = ['isEnabled', 'listModels', 'isInterruptedSessionResumable', ...methods];
  app.use(servicePath, stub, { methods: [...new Set(methodNames)] });
  registerAgentSdk(app, { key, label, servicePath });
}

/** Stub Claude at its registered path so dispatch goes through `agent-sdks`. */
export function useClaudeAgentStub(app, service, methods) {
  useAgentServiceStub(
    app,
    {
      key: CLAUDE_AGENT_SDK_KEY,
      label: CLAUDE_AGENT_SDK_LABEL,
      servicePath: CLAUDE_AGENT_SERVICE_PATH,
    },
    service,
    methods
  );
}

/** Stub Cursor at its registered path so dispatch goes through `agent-sdks`. */
export function useCursorAgentStub(app, service, methods) {
  useAgentServiceStub(
    app,
    {
      key: CURSOR_AGENT_SDK_KEY,
      label: CURSOR_AGENT_SDK_LABEL,
      servicePath: CURSOR_AGENT_SERVICE_PATH,
    },
    service,
    methods
  );
}
