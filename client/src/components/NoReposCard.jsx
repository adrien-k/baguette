import { ChevronRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function NoReposCard() {
  return (
    <Link
      to="/settings?tab=repos"
      className="flex items-center gap-4 p-4 rounded-lg border border-dashed border-zinc-700 hover:border-amber-500/50 hover:bg-amber-500/5 transition-colors group"
    >
      <div className="shrink-0 w-9 h-9 rounded-md bg-zinc-800 group-hover:bg-amber-500/10 flex items-center justify-center transition-colors">
        <Plus className="w-4 h-4 text-zinc-500 group-hover:text-amber-400 transition-colors" />
      </div>
      <div>
        <p className="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors">
          Add a repository to get started
        </p>
        <p className="text-xs text-zinc-500 mt-0.5">Configure repositories in Settings</p>
      </div>
      <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-amber-400 ml-auto transition-colors" />
    </Link>
  );
}
