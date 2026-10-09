export type AskUserAnswer = { question?: string; value?: string };

export default function AskUserAnswerBlock({
  answers,
  fallbackText,
}: {
  answers?: AskUserAnswer[] | null;
  fallbackText?: string | null;
}) {
  const list = answers?.filter((a) => a.question || a.value) ?? [];
  if (list.length === 0 && !fallbackText?.trim()) return null;

  return (
    <div className="rounded-lg border border-brand/20 bg-soft-accent/10 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 border-b border-brand/10">
        <p className="text-xs text-accent/70">Your answers</p>
      </div>
      <div className="px-3 sm:px-4 py-3 space-y-2 text-sm text-fg">
        {list.length > 0
          ? list.map((a, i) => (
              <div key={i}>
                <div className="font-medium text-secondary">{a.question}</div>
                <div className="text-fg">{a.value}</div>
              </div>
            ))
          : fallbackText?.trim() && <p className="whitespace-pre-wrap">{fallbackText}</p>}
      </div>
    </div>
  );
}
