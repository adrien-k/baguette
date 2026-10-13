import CursorModelPreferencesSection from '../../components/CursorModelPreferencesSection.jsx';
import AgentConfigsList from './AgentConfigsList.jsx';
import AgentDefaultsSection from './AgentDefaultsSection.jsx';
import { SettingsSection, SettingsTabHeader } from '../../components/SettingsSection.jsx';

export default function AgentSettingsTab({ settings, onSave }) {
  return (
    <div>
      <SettingsTabHeader title="Agent">
        Named Claude, Cursor, and Pi configurations plus default model parameters (account-wide).
        System prompts live under Prompts.
      </SettingsTabHeader>

      <div className="space-y-6">
        <SettingsSection
          title="Agent configurations"
          description="API keys and gateway URLs for Claude, Cursor, and Pi. Each configuration can be selected when starting a session."
        >
          <AgentConfigsList />
        </SettingsSection>

        <SettingsSection
          title="Session defaults"
          description="Default agent configuration and model for new sessions and the Issues reviewer. Scope defaults to all repositories or a single linked repo; unset values inherit from the broader scope or your most recent session."
        >
          <AgentDefaultsSection settings={settings} onSave={onSave} />
        </SettingsSection>

        <SettingsSection
          title="Default model parameters"
          description="Account-wide defaults for effort, context, fast mode, reasoning, and related chips when you pick a Claude, Cursor, or Pi model in the dashboard, builder, or MCP. If a model does not offer an exact match, Baguette picks the closest option."
        >
          <CursorModelPreferencesSection />
        </SettingsSection>
      </div>
    </div>
  );
}
