import { useMemo } from 'react';
import { Layers } from 'lucide-react';
import RepoDropdown, { repoDropdownRepoSections } from '../../components/RepoDropdown.jsx';

export const REPO_SCOPE_ALL_LABEL = 'All my repos';

export function useRepoScopeSections(repos) {
  return useMemo(
    () => [
      {
        options: [
          {
            value: '',
            label: REPO_SCOPE_ALL_LABEL,
            icon: <Layers className="w-3.5 h-3.5 shrink-0" />,
          },
        ],
      },
      ...repoDropdownRepoSections(repos, (r) => r.id),
    ],
    [repos]
  );
}

export function repoScopeTriggerTitle(value) {
  return value
    ? 'Repository scope: this repo only'
    : `Repository scope: ${REPO_SCOPE_ALL_LABEL.toLowerCase()}`;
}

export function RepoScopeAside({ id, value, onChange, repos }) {
  const sections = useRepoScopeSections(repos);
  return (
    <RepoDropdown
      id={id}
      value={value}
      onChange={onChange}
      sections={sections}
      ariaLabel="Repository scope"
      triggerTitle={repoScopeTriggerTitle(value)}
    />
  );
}
