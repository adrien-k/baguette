import { Loader2, Play } from 'lucide-react';
import ButtonWithOptions from './ButtonWithOptions.jsx';

const REVIEW_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-1.5 w-full min-w-0 whitespace-nowrap px-3 py-1.5 text-sm font-medium @min-[36rem]:w-auto';

/**
 * Issues-tab control: run a latest-changes review on the reviewer agent.
 */
export default function ReviewLatestChangesButton({ disabled, loading, onReview }) {
  return (
    <ButtonWithOptions
      type="button"
      disabled={disabled || loading}
      onClick={onReview}
      className={REVIEW_BUTTON_CLASS}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
      Review latest changes
    </ButtonWithOptions>
  );
}
