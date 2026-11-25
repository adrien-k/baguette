import { AlertTriangle, ArrowUpToLine, CheckCircle2 } from 'lucide-react';

type GitPushOutcome = 'pushed' | 'canceled' | 'failed';

export default function GitPushOutcomeBlock({
  outcome,
  error,
  targetBranch,
  sourceBranch,
  fallbackText,
}: {
  outcome?: GitPushOutcome | null;
  error?: string | null;
  targetBranch?: string | null;
  sourceBranch?: string | null;
  fallbackText?: string;
}) {
  const pushed = outcome === 'pushed';
  const canceled = outcome === 'canceled';
  const failed = outcome === 'failed';

  const heading = pushed
    ? 'Push approved'
    : canceled
      ? 'Push rejected'
      : failed
        ? 'Push failed'
        : 'GitPush outcome';

  const Icon = pushed ? CheckCircle2 : failed ? AlertTriangle : ArrowUpToLine;
  const iconClass = pushed
    ? 'text-success'
    : failed
      ? 'text-danger'
      : canceled
        ? 'text-faint'
        : 'text-muted';

  return (
    <div className="space-y-2 text-sm">
      <div className={`flex items-center gap-2 font-medium ${iconClass}`}>
        <Icon className="w-4 h-4 shrink-0" aria-hidden />
        <span>{heading}</span>
      </div>
      {(sourceBranch || targetBranch) && (
        <div className="text-faint text-xs font-mono">
          {sourceBranch && targetBranch
            ? `${sourceBranch} → origin/${targetBranch}`
            : targetBranch
              ? `origin/${targetBranch}`
              : sourceBranch}
        </div>
      )}
      {failed && error ? (
        <pre className="text-xs text-danger whitespace-pre-wrap break-words bg-danger/10 border border-danger/25 rounded p-2">
          {error}
        </pre>
      ) : fallbackText ? (
        <CollapsibleFallback text={fallbackText} />
      ) : null}
    </div>
  );
}

function CollapsibleFallback({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lines = trimmed.split('\n');
  if (lines.length <= 4) {
    return <p className="text-muted whitespace-pre-wrap">{trimmed}</p>;
  }
  return (
    <details className="text-muted">
      <summary className="cursor-pointer text-xs text-faint">Details</summary>
      <pre className="mt-2 text-xs whitespace-pre-wrap">{trimmed}</pre>
    </details>
  );
}
