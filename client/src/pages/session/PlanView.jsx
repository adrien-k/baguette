import CollapsibleMarkdown from '../../components/chat/CollapsibleMarkdown.tsx';
import SessionTodosPanel from '../../components/session/SessionTodosPanel.jsx';
import { useGetSessionPlan } from '../../hooks/useGetSessionPlan.js';

export default function PlanView({ session, readonly = false }) {
  const sessionId = session?.id;
  const { markdown: planMarkdown, loading: planLoading } = useGetSessionPlan(sessionId, {
    enabled: sessionId != null,
  });

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-8">
      <section>
        <h2 className="text-sm font-medium text-heading mb-3">Plan</h2>
        {planLoading ? (
          <p className="text-sm text-faint">Loading…</p>
        ) : planMarkdown.trim() ? (
          <CollapsibleMarkdown previewLines={12} simpleToggle>
            {planMarkdown}
          </CollapsibleMarkdown>
        ) : (
          <p className="text-sm text-faint">No plan yet.</p>
        )}
      </section>
      <section>
        <h2 className="text-sm font-medium text-heading mb-3">Todos</h2>
        <SessionTodosPanel sessionId={sessionId} editable={!readonly} />
      </section>
    </div>
  );
}
