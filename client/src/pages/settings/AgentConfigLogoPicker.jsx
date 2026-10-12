import { useMemo } from 'react';
import {
  AGENT_CONFIG_LOGO_OPTIONS,
  SDK_DEFAULT_LOGO_OPTION,
} from '@baguette/shared/agent-config-logo.js';
import SearchableSelect from '../../components/SearchableSelect';
import AgentConfigLogo from '../../components/AgentConfigLogo.jsx';
import { formatAgentSdkDisplayName } from '@baguette/shared/agent-sdk-display.js';

function optionLabel(entry) {
  if (entry.id === SDK_DEFAULT_LOGO_OPTION) return entry.label;
  return entry.fullTitle || entry.title || entry.id;
}

export default function AgentConfigLogoPicker({ sdk, value, onChange, disabled = false }) {
  const options = useMemo(() => {
    const sdkLabel = formatAgentSdkDisplayName(sdk);
    return [
      {
        id: SDK_DEFAULT_LOGO_OPTION,
        title: 'SDK default',
        fullTitle: `SDK default (${sdkLabel})`,
        label: `SDK default (${sdkLabel})`,
      },
      ...AGENT_CONFIG_LOGO_OPTIONS,
    ];
  }, [sdk]);

  const selectValue = value == null || value === '' ? SDK_DEFAULT_LOGO_OPTION : value;

  const renderLogoMark = (entry) => (
    <AgentConfigLogo
      sdk={sdk}
      logo={entry.id === SDK_DEFAULT_LOGO_OPTION ? null : entry.id}
      className="w-5 h-5 shrink-0"
      size={20}
    />
  );

  const renderLogoOption = (entry) => (
    <span className="flex items-center gap-2 min-w-0">
      {renderLogoMark(entry)}
      <span className="truncate">{optionLabel(entry)}</span>
    </span>
  );

  return (
    <SearchableSelect
      value={selectValue}
      onChange={(next) => onChange(next === SDK_DEFAULT_LOGO_OPTION ? null : next)}
      options={options}
      disabled={disabled}
      placeholder="Search icons…"
      emptyText="No matching icons"
      getOptionValue={(o) => o.id}
      getOptionLabel={optionLabel}
      renderOption={renderLogoOption}
      renderSelected={renderLogoOption}
    />
  );
}
