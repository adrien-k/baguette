import type { FileReferenceBlock as FileReferenceBlockType } from '@baguette/shared/message-types.ts';

export default function FileReferenceBlock({ block }: { block: FileReferenceBlockType }) {
  const changeLabel =
    block.change === 'added' ? 'added' : block.change === 'removed' ? 'removed' : null;
  const changeClass =
    block.change === 'added'
      ? 'text-success border-success/30 bg-success/10'
      : block.change === 'removed'
        ? 'text-danger border-danger/30 bg-danger/10'
        : 'text-warning/90 border-brand/30 bg-brand/10';

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${changeClass} border rounded px-2 py-1 w-fit font-mono`}
    >
      <span className="inline-flex items-center gap-0.5">
        <span className="text-accent/80">@</span>
        <span>
          {block.path}:{block.line}
        </span>
      </span>
      {block.short_sha && (
        <span className="text-fg-muted font-sans text-[11px]">commit {block.short_sha}</span>
      )}
      {changeLabel && (
        <span className="text-fg-muted font-sans text-[11px]">change: {changeLabel}</span>
      )}
    </div>
  );
}
