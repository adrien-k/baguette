import { groupReposByOrg } from '../utils/repoDisplayName.js';

const ORG_HEADING_CLASS = 'text-[10px] font-medium uppercase tracking-wide text-faint mb-1';

/**
 * Repository rows grouped by GitHub owner org (or trailing "Local" group).
 * @param {object[]} repos
 * @param {string} [emptyMessage]
 * @param {(repo: object) => import('react').ReactNode} renderRepo
 */
export default function GroupedRepositoriesList({ repos, emptyMessage, renderRepo }) {
  if (repos.length === 0) {
    return emptyMessage ? (
      <p className="text-faint text-sm text-center py-8">{emptyMessage}</p>
    ) : null;
  }

  const groups = groupReposByOrg(repos);

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.org}>
          <h4 className={ORG_HEADING_CLASS}>{group.org}</h4>
          <div className="divide-y divide-line">{group.repos.map((r) => renderRepo(r))}</div>
        </div>
      ))}
    </div>
  );
}
