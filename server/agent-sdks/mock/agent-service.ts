import { isMockAgentSdkEnabled } from '../../../shared/mock-agent-sdk.js';
import { acpToolCallBuilders } from '../acp-mapping.ts';
import { registerGenericAgentService } from '../generic-agent-service.ts';
import { registerSdkPlugin } from '../registry.js';
import type { AgentApp } from '../../services/feathers/agent-service-types.ts';
import { MockDriver } from './driver.ts';
import { MOCK_AGENT_SDK, MOCK_AGENT_SDK_LABEL, MOCK_AGENT_SERVICE_PATH } from './meta.js';

export function registerMockAgentService(app: AgentApp, path = MOCK_AGENT_SERVICE_PATH) {
  if (!isMockAgentSdkEnabled()) return;
  // Tests may mount this service without the SDK manifest; keep the module
  // registry in sync so message writers find mock tool-call builders.
  registerSdkPlugin({
    key: MOCK_AGENT_SDK,
    label: MOCK_AGENT_SDK_LABEL,
    servicePath: path,
    requiresApiKey: false,
    ownerOnlySystemAuth: false,
    supportsModelParams: false,
    storedSessionIdColumn: null,
    toolCallBuilders: acpToolCallBuilders,
  });
  registerGenericAgentService(
    app,
    {
      key: MOCK_AGENT_SDK,
      label: MOCK_AGENT_SDK_LABEL,
      servicePath: path,
      storedSessionIdColumn: null,
      supportsCompactionBeforeLoopRepeat: false,
      registerCompactionHook: false,
      emitAppErrorEvenWithWriter: true,
      createDriver: ({ app: svcApp }) => new MockDriver(svcApp),
    },
    path
  );
}
