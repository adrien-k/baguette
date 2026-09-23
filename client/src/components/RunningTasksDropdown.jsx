import { useState, useEffect, useRef, useMemo } from 'react';
import { Loader2, Square, Terminal } from 'lucide-react';
import { tasksService } from '../feathers.js';
import { useGetTasks } from '../hooks/useGetTasks.js';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import TaskLogModal from './TaskLogModal.jsx';
import { repoDisplayName } from '../utils/repoDisplayName.js';

export default function RunningTasksDropdown() {
  const { tasks: runningTasks } = useGetTasks({ status: 'running' });
  const { sessions } = useSessionsContext();
  const [open, setOpen] = useState(false);
  const [modalTaskId, setModalTaskId] = useState(null);
  const dropdownRef = useRef(null);

  const sessionById = useMemo(() => {
    const m = new Map();
    (sessions || []).forEach((s) => m.set(s.id, s));
    return m;
  }, [sessions]);

  const tasksByRepo = useMemo(() => {
    const groups = new Map();
    for (const task of runningTasks) {
      const session = sessionById.get(task.session_id);
      const repoKey = session?.repo_full_name ?? `__session_${task.session_id}`;
      if (!groups.has(repoKey)) {
        groups.set(repoKey, { repoFullName: session?.repo_full_name ?? null, tasks: [] });
      }
      groups.get(repoKey).tasks.push(task);
    }
    return [...groups.entries()]
      .sort(([, a], [, b]) => {
        const nameA = a.repoFullName ? repoDisplayName(a.repoFullName) : 'Unknown repo';
        const nameB = b.repoFullName ? repoDisplayName(b.repoFullName) : 'Unknown repo';
        return nameA.localeCompare(nameB);
      })
      .map(([key, group]) => ({ key, ...group }));
  }, [runningTasks, sessionById]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleKill = (taskId) => {
    tasksService.kill(taskId);
  };

  const handleKillFromDropdown = (e, taskId) => {
    e.stopPropagation();
    handleKill(taskId);
  };

  const openModal = (taskId) => {
    setModalTaskId(taskId);
    setOpen(false);
  };

  const closeModal = () => {
    setModalTaskId(null);
  };

  const modalTask = runningTasks.find((t) => t.id === modalTaskId);

  if (runningTasks.length === 0 && modalTaskId == null) return null;

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        {runningTasks.length > 0 && (
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 transition-colors"
            title={`${runningTasks.length} running task${runningTasks.length !== 1 ? 's' : ''}`}
          >
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            <span className="text-xs font-medium text-emerald-400">{runningTasks.length}</span>
          </button>
        )}

        {open && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden z-50">
            <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-xs font-medium text-zinc-400">Running Tasks</span>
            </div>
            <div className="max-h-64 overflow-auto">
              {tasksByRepo.map(({ key, repoFullName, tasks }) => (
                <div key={key}>
                  <div className="px-3 py-1.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wider bg-zinc-900 border-b border-zinc-800 sticky top-0">
                    {repoFullName ? repoDisplayName(repoFullName) : 'Unknown repo'}
                  </div>
                  {tasks.map((task) => {
                    const session = sessionById.get(task.session_id);
                    return (
                      <div
                        key={task.id}
                        onClick={() => openModal(task.id)}
                        className="px-3 py-2.5 border-b border-zinc-800 last:border-b-0 cursor-pointer hover:bg-zinc-800/60 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <code className="text-xs text-zinc-200 truncate block">
                              {task.label || task.command}
                            </code>
                            {session && (
                              <span className="text-[11px] text-zinc-500 truncate block mt-0.5">
                                {session.label || session.short_id}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={(e) => handleKillFromDropdown(e, task.id)}
                            className="text-red-400 hover:text-red-300 opacity-60 hover:opacity-100 transition-all shrink-0"
                            title="Stop"
                          >
                            <Square className="w-3.5 h-3.5 fill-current" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {modalTaskId != null && modalTask && (
        <TaskLogModal
          task={modalTask}
          session={(() => {
            const s = sessionById.get(modalTask.session_id);
            return s
              ? {
                  id: s.id,
                  label: s.label,
                  repo_full_name: s.repo_full_name,
                  base_branch: s.base_branch,
                  pr_url: s.pr_url,
                  pr_number: s.pr_number,
                }
              : null;
          })()}
          onKill={(id) => {
            handleKill(id);
            closeModal();
          }}
          onClose={closeModal}
        />
      )}
    </>
  );
}
