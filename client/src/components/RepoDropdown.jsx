import { useMemo } from 'react';
import LightChipDropdown from './LightChipDropdown.jsx';
import GithubIcon from './svg/GithubIcon.jsx';
import { repoDisplayName, isLocalRepo, groupReposByOrg } from '../utils/repoDisplayName.js';

const ICON_CLS = 'w-3.5 h-3.5 shrink-0';

/**
 * Repo rows grouped by org (GitHub owner or "Local"), for use in dropdown sections.
 * @param {object[]} repos
 * @param {(repo: object) => string} [getValue] option value (default: full_name)
 */
export function repoDropdownRepoSections(repos, getValue = (r) => r.full_name) {
  return groupReposByOrg(repos).map((group) => ({
    heading: group.org,
    options: group.repos.map((r) => ({
      value: String(getValue(r)),
      label: repoDisplayName(r.full_name),
      icon: <GithubIcon className={ICON_CLS} />,
      detail: isLocalRepo(r.full_name) ? 'local' : undefined,
    })),
  }));
}

/**
 * List-style repo picker. Callers pass full `sections` (special entries + repoDropdownRepoSections).
 */
export default function RepoDropdown({
  value,
  onChange,
  sections,
  footer = null,
  selectedDisplay,
  placement = 'bottom-end',
  id,
  triggerTitle,
  fullWidth = false,
  className = '',
  ariaLabel = 'Choose repository',
}) {
  const resolvedValue = value === undefined || value === null ? '' : String(value);

  const flatOptions = useMemo(() => sections.flatMap((s) => s.options), [sections]);

  const selected = flatOptions.find((o) => o.value === resolvedValue);

  const display =
    selectedDisplay ??
    (selected ? { label: selected.label, icon: selected.icon } : { label: 'Select', icon: null });

  return (
    <div className={className}>
      <LightChipDropdown
        id={id}
        layout="list"
        value={resolvedValue}
        onChange={onChange}
        sections={sections}
        footer={footer}
        selectedDisplay={display}
        ariaLabel={ariaLabel}
        placement={placement}
        triggerTitle={triggerTitle ?? display.label}
        fullWidth={fullWidth}
      />
    </div>
  );
}
