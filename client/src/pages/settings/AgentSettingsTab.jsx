import CursorModelPreferencesSection from '../../components/CursorModelPreferencesSection.jsx';
import AgentConfigsList from './AgentConfigsList.jsx';
import AgentDefaultsSection from './AgentDefaultsSection.jsx';
import { SettingsSection, SettingsTabHeader } from '../../components/SettingsSection.jsx';

export default function AgentSettingsTab({ settings, onSave }) {
  return (
    <div>
      <SettingsTabHeader title="Agent">
        Named Claude, Cursor, and Pi configurations plus Cursor model preferences (account-wide).
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
          description="Default agent configuration and model for new sessions and the reviewer panel. Scope defaults to all repositories or a single linked repo; unset values inherit from the broader scope or your most recent session."
        >
          <AgentDefaultsSection settings={settings} onSave={onSave} />
        </SettingsSection>

        <SettingsSection
          title="Cursor model preferences"
          description="Used when starting Cursor sessions from the dashboard, builder, and MCP. If a model does not offer a strict match for a parameter, Baguette selects the closest available option."
        >
          <CursorModelPreferencesSection />
        </SettingsSection>
      </div>
    </div>
  );
}
