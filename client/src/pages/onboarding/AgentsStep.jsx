import AgentConfigsList from '../settings/AgentConfigsList.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import { identityIsUsable } from '../../utils/onboardingSteps.js';

export default function AgentsStep({
  user,
  githubConfigured,
  onBack,
  onFinish,
  completing,
  showBack,
}) {
  const canFinish = identityIsUsable(user, { githubConfigured });

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg mb-2">Connect your agents</h1>
      <p className="text-fg-muted text-sm mb-8">
        Add at least one Claude, Cursor, or Pi configuration. You can edit these any time in
        Settings → Agent.
      </p>
      <AgentConfigsList />
      <div className={`mt-8 flex gap-2 ${showBack ? 'justify-between' : 'justify-end'}`}>
        {showBack ? (
          <button type="button" className={GHOST_BUTTON_CLASS} onClick={onBack}>
            Back
          </button>
        ) : null}
        <button
          type="button"
          className={PRIMARY_BUTTON_SIZED}
          onClick={onFinish}
          disabled={completing || !canFinish}
        >
          {completing ? 'Finishing…' : 'Finish setup'}
        </button>
      </div>
    </div>
  );
}
