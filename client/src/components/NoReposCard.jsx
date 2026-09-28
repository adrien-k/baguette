import { ChevronRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function NoReposCard() {
  return (
    <Link
      to="/settings?tab=repos"
      className="flex items-center gap-4 p-4 rounded-lg border border-dashed border-strong hover:border-brand/50 hover:bg-brand/5 transition-colors group"
    >
      <div className="shrink-0 w-9 h-9 rounded-md bg-control group-hover:bg-brand/10 flex items-center justify-center transition-colors">
        <Plus className="w-4 h-4 text-faint group-hover:text-accent transition-colors" />
      </div>
      <div>
        <p className="text-sm font-medium text-secondary group-hover:text-fg transition-colors">
          Add a repository to get started
        </p>
        <p className="text-xs text-faint mt-0.5">Configure repositories in Settings</p>
      </div>
      <ChevronRight className="w-4 h-4 text-faint group-hover:text-accent ml-auto transition-colors" />
    </Link>
  );
}
