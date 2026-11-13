import CursorModelPreferencesSection from '../../components/CursorModelPreferencesSection.jsx';
import AgentConfigsList from './AgentConfigsList.jsx';
import AgentDefaultsSection from './AgentDefaultsSection.jsx';
import AgentPresetModelsSection from './AgentPresetModelsSection.jsx';
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
          description="Default models for the dashboard builder and the Issues reviewer, and which models an agent may use when it creates a session, loop, or subagent."
        >
          <AgentDefaultsSection settings={settings} onSave={onSave} />
        </SettingsSection>

        <SettingsSection
          title="Preset models"
          description="Favorite agent configuration, model, and parameters with a short description. Agents pass these by id when Agent-created sessions and subagents allows presets."
        >
          <AgentPresetModelsSection />
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
