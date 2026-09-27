import { diffLines } from 'diff';
import { DIFF_LINE_WRAP_CLASS, DIFF_SCROLL_WRAP_CLASS } from '../../utils/diffLineWrap.js';

function EditDiffPreview({ oldString, newString, maxLines = 7, onExpand }) {
  const parts = diffLines(oldString ?? '', newString ?? '');
  const lines = [];
  for (const part of parts) {
    if (part.added || part.removed) {
      const prefix = part.added ? '+' : '-';
      const cls = part.added ? 'text-green-400' : 'text-red-400';
      const raw = part.value.split('\n');
      if (raw[raw.length - 1] === '') raw.pop();
      for (const line of raw) {
        lines.push({ prefix, cls, line });
        if (lines.length >= maxLines) break;
      }
    }
    if (lines.length >= maxLines) break;
  }
  const totalChanged = parts.reduce((acc, p) => {
    if (!p.added && !p.removed) return acc;
    const raw = p.value.split('\n');
    if (raw[raw.length - 1] === '') raw.pop();
    return acc + raw.length;
  }, 0);
  const remaining = totalChanged - maxLines;

  return (
    <pre className={`px-3 sm:px-4 pb-2 text-xs font-mono bg-transparent ${DIFF_LINE_WRAP_CLASS}`}>
      {lines.map((l, i) => (
        <div key={i} className={`${l.cls} ${DIFF_LINE_WRAP_CLASS}`}>
          {l.prefix}
          {l.line}
        </div>
      ))}
      {remaining > 0 && (
        <button
          onClick={onExpand}
          className="text-zinc-600 hover:text-zinc-400 transition-colors text-left"
        >
          &hellip; {remaining} more line{remaining !== 1 ? 's' : ''}
        </button>
      )}
    </pre>
  );
}

function DiffStringView({ diffString, maxLines, onExpand }) {
  const lines = (diffString || '').split('\n');
  const displayLines = [];
  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    const ch = line[0];
    if (ch === '+') displayLines.push({ cls: 'text-green-400', text: line });
    else if (ch === '-') displayLines.push({ cls: 'text-red-400', text: line });
    else if (line.startsWith('@@')) displayLines.push({ cls: 'text-cyan-500/80', text: line });
    else displayLines.push({ cls: 'text-zinc-600', text: line });
    if (maxLines && displayLines.length >= maxLines) break;
  }
  const totalChanged = lines.filter((l) => l[0] === '+' || l[0] === '-').length;
  const remaining =
    totalChanged -
    displayLines.filter((l) => l.cls.includes('green') || l.cls.includes('red')).length;
  return (
    <pre className={`px-3 sm:px-4 pb-2 text-xs font-mono bg-transparent ${DIFF_LINE_WRAP_CLASS}`}>
      {displayLines.map((l, i) => (
        <div key={i} className={`${l.cls} ${DIFF_LINE_WRAP_CLASS}`}>
          {l.text}
        </div>
      ))}
      {remaining > 0 && onExpand && (
        <button
          onClick={onExpand}
          className="text-zinc-600 hover:text-zinc-400 transition-colors text-left"
        >
          &hellip; {remaining} more line{remaining !== 1 ? 's' : ''}
        </button>
      )}
    </pre>
  );
}

/**
 * Renders a diff for Edit/Write tool calls.
 *
 * Pass oldString=null to signal "no string inputs available" — cursor diff will be used.
 * Pass oldString="" for Write (new file, all additions).
 *
 * collapsed=true → compact preview (5 lines); collapsed=false → full diff.
 */
export default function EditDiffView({
  oldString,
  newString,
  cursorDiff,
  collapsed = false,
  onExpand,
  label = 'Changes',
}) {
  const useCursorDiff = cursorDiff?.diffString != null && oldString == null;

  if (collapsed) {
    return useCursorDiff ? (
      <DiffStringView diffString={cursorDiff.diffString} maxLines={7} onExpand={onExpand} />
    ) : (
      <EditDiffPreview
        oldString={oldString ?? ''}
        newString={newString ?? ''}
        onExpand={onExpand}
      />
    );
  }

  return (
    <div>
      <div className="text-zinc-500 font-medium mb-1">{label}</div>
      {useCursorDiff ? (
        <div
          className={`text-xs font-mono max-h-96 rounded bg-zinc-950/50 py-1 ${DIFF_SCROLL_WRAP_CLASS}`}
        >
          <DiffStringView diffString={cursorDiff.diffString} />
        </div>
      ) : (
        <pre
          className={`text-xs font-mono max-h-96 rounded bg-zinc-950/50 ${DIFF_SCROLL_WRAP_CLASS} ${DIFF_LINE_WRAP_CLASS}`}
        >
          {diffLines(oldString ?? '', newString ?? '').flatMap((part, i) => {
            const prefix = part.added ? '+' : part.removed ? '-' : ' ';
            const cls = part.added
              ? 'bg-emerald-500/12 text-emerald-400'
              : part.removed
                ? 'bg-red-500/12 text-red-400'
                : 'text-zinc-600';
            const lines = part.value.split('\n');
            if (lines[lines.length - 1] === '') lines.pop();
            return lines.map((line, li) => (
              <div key={`${i}-${li}`} className={`px-2 ${cls} ${DIFF_LINE_WRAP_CLASS}`}>
                {prefix}
                {line}
              </div>
            ));
          })}
        </pre>
      )}
    </div>
  );
}
