import { registerAgentsService } from './agents.service.js';
import { registerMessagesService } from './messages.service.js';
import { registerSessionsService } from './sessions.service.js';
import { registerTasksService } from './tasks.service.js';
import { registerSecretsService } from './secrets.service.js';
import { registerUsersService } from './users.service.js';
import { registerReposService } from './repos.service.js';
import { registerUserReposService } from './user-repos.service.js';
import { registerClaudeAgentService } from './claude-agent.service.ts';
import { registerCursorAgentService } from './cursor-agent.service.ts';
import { registerPiAgentService } from './pi-agent.service.ts';
import { registerMockAgentService } from './mock-agent.service.ts';
import { registerAgentConfigsService } from './agent-configs.service.js';
import { registerAgentModelPresetsService } from './agent-model-presets.service.js';
import { registerPluginsService } from './plugins.service.js';
import { registerSlackService } from './slack.service.js';
import { registerQueuedMessagesService } from './queued-messages.service.js';
import { registerLoopsService } from './loops.service.js';
import { registerSessionIssuesService } from './session-issues.service.js';
import { registerSessionTodosService } from './session-todos.service.js';
import { registerSessionPlansService } from './session-plans.service.js';
import { registerReviewAgentTurn } from '../review-agent-turn.js';
import { registerUsageModelPricingService } from './usage-model-pricing.service.js';
import { registerUsageService } from './usage.service.js';
import { registerFeathersRealtime } from './realtime.js';

/**
 * Register Feathers services, SSE, and channel publishers.
 * Call before feathersApp.setup(server).
 */
export function registerFeathersServices(app) {
  registerMessagesService(app);
  registerAgentsService(app);
  registerSessionsService(app);
  registerQueuedMessagesService(app);
  registerAgentConfigsService(app);
  registerAgentModelPresetsService(app);
  registerClaudeAgentService(app);
  registerCursorAgentService(app);
  registerPiAgentService(app);
  registerMockAgentService(app);
  registerTasksService(app);
  registerSecretsService(app);
  registerUsersService(app);
  registerReposService(app);
  registerUserReposService(app);
  registerPluginsService(app);
  registerSlackService(app);
  registerLoopsService(app);
  registerSessionIssuesService(app);
  registerSessionTodosService(app);
  registerSessionPlansService(app);
  registerReviewAgentTurn(app);
  registerUsageModelPricingService(app);
  registerUsageService(app);

  app.service('sessions').registerActivityMessageListeners(app);

  registerFeathersRealtime(app);
}
