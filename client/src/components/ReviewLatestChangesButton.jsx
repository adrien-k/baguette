import { Loader2, Play } from 'lucide-react';
import ButtonWithOptions from './ButtonWithOptions.jsx';

const REVIEW_BUTTON_CLASS =
  'inline-flex min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 w-full whitespace-nowrap px-3 py-1.5 text-sm font-medium @min-[36rem]:w-auto @min-[36rem]:flex-none @min-[36rem]:basis-auto @min-[36rem]:shrink-0';

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
