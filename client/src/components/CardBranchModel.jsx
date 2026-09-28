import { parseModelField } from '../utils/models.js';

/** Source → target branch plus SDK/model, aligned under the card title. */
export default function CardBranchModel({ isGlobal, baseBranch, targetBranch, agentSdk, model }) {
  const sdk = agentSdk === 'cursor' ? 'Cursor' : 'Claude';
  const modelLabel = model ? parseModelField(model) : null;
  const showBranches = !isGlobal && (baseBranch || targetBranch);

  return (
    <div className="text-xs text-fg-muted mt-1 mb-1.5 sm:mb-2 ml-5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {showBranches && (
        <>
          {baseBranch && <span>{baseBranch}</span>}
          {targetBranch && <span className="text-faint">→ {targetBranch}</span>}
        </>
      )}
      <span className="text-faint flex items-center gap-1">
        {showBranches && <span>·</span>}
        <span>{sdk}</span>
        {modelLabel && <span>{modelLabel}</span>}
      </span>
    </div>
  );
}
