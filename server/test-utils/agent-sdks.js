import {
  CLAUDE_AGENT_SDK_KEY,
  CLAUDE_AGENT_SDK_LABEL,
  CLAUDE_AGENT_SERVICE_PATH,
  CURSOR_AGENT_SDK_KEY,
} from '../services/agent-sdk-meta.js';
import {
  registerAgentSdk,
  registerAgentConfigsService,
} from '../services/feathers/agent-configs.service.js';

/** Mount `agent-configs` when the test app does not already have it (SDK registry + dispatch). */
export function mountAgentConfigs(app) {
  if (!app.services?.['agent-configs']) {
    registerAgentConfigsService(app);
  }
}

function useAgentServiceStub(app, { key, label, servicePath }, service, methods) {
  mountAgentConfigs(app);
  const stub = {
    async handleMessageCreated() {},
    async isInterruptedSessionResumable(_session, { agent } = {}) {
      if (!agent) return false;
      if (key === CURSOR_AGENT_SDK_KEY) {
        return Boolean(agent.cursor_agent_id);
      }
      return Boolean(agent.claude_session_id);
    },
    usesCompactionBeforeLoopRepeat() {
      return key !== CURSOR_AGENT_SDK_KEY;
    },
    ...service,
  };
  const methodNames = ['handleMessageCreated', 'isInterruptedSessionResumable', ...methods];
  app.use(servicePath, stub, { methods: [...new Set(methodNames)] });
  registerAgentSdk(app, { key, label, servicePath });
}

/** Stub Claude at its registered path so dispatch goes through `agent-configs`. */
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
