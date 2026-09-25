import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, Layers, Plus } from 'lucide-react';
import { useRepoContext, ALL_REPOS, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import RepoDropdown, { repoDropdownRepoSections } from './RepoDropdown.jsx';
import GithubIcon from './svg/GithubIcon.jsx';
import { formatRepoLabel, repoDisplayName } from '../utils/repoDisplayName.js';

const ICON_CLS = 'w-3.5 h-3.5 shrink-0';

function navIcon(value) {
  if (value === ALL_REPOS) return <Layers className={ICON_CLS} />;
  if (value === GLOBAL_SCOPE) return <Bot className={ICON_CLS} />;
  return <GithubIcon className={ICON_CLS} />;
}

export default function RepoPicker({
  className = '',
  includeAllSessions = true,
  includeGlobal = true,
  includeManage = true,
  navigateOnSelect = true,
  syncContext = true,
  showOrgInLabel = false,
  fullWidth = false,
  value,
  onChange,
}) {
  const { repos, selectedRepo, setSelectedRepo } = useRepoContext();
  const navigate = useNavigate();

  const current = value !== undefined ? value : selectedRepo;

  const sections = useMemo(() => {
    const blocks = [];
    if (includeAllSessions) {
      blocks.push({
        options: [
          {
            value: ALL_REPOS,
            label: 'All sessions',
            icon: <Layers className={ICON_CLS} />,
          },
        ],
      });
    }
    if (includeGlobal) {
      blocks.push({
        options: [
          {
            value: GLOBAL_SCOPE,
            label: 'Global',
            icon: <Bot className={ICON_CLS} />,
          },
        ],
      });
    }
    blocks.push(...repoDropdownRepoSections(repos));
    return blocks;
  }, [repos, includeAllSessions, includeGlobal]);

  const selectedDisplay = useMemo(() => {
    const flat = sections.flatMap((s) => s.options);
    const hit = flat.find((o) => o.value === String(current));
    if (hit) {
      let label = hit.label;
      if (showOrgInLabel && current && current !== ALL_REPOS && current !== GLOBAL_SCOPE) {
        label = formatRepoLabel(current);
      }
      return { label, icon: hit.icon };
    }
    if (current === ALL_REPOS) {
      return { label: 'All sessions', icon: navIcon(ALL_REPOS) };
    }
    if (current === GLOBAL_SCOPE) {
      return { label: 'Global', icon: navIcon(GLOBAL_SCOPE) };
    }
    if (current) {
      const label = showOrgInLabel ? formatRepoLabel(current) : repoDisplayName(current);
      return { label, icon: navIcon(current) };
    }
    return { label: 'Select repo', icon: null };
  }, [sections, current, showOrgInLabel]);

  const handleChange = (next) => {
    onChange?.(next);
    if (syncContext) setSelectedRepo(next);
    if (navigateOnSelect) {
      if (next === ALL_REPOS) navigate('/');
      else if (next === GLOBAL_SCOPE) navigate('/global');
      else {
        const repo = repos.find((r) => r.full_name === next);
        if (repo) navigate(`/repos/${repo.id}`);
      }
    }
  };

  const footer = includeManage ? (
    <Link
      to="/settings?tab=repos"
      className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors"
    >
      <Plus className="w-3.5 h-3.5" />
      Manage repositories
    </Link>
  ) : null;

  return (
    <RepoDropdown
      value={current}
      onChange={handleChange}
      sections={sections}
      footer={footer}
      selectedDisplay={selectedDisplay}
      fullWidth={fullWidth}
      className={className}
      placement="bottom-end"
    />
  );
}
