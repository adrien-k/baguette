import { Loader2, Play } from 'lucide-react';
import ButtonWithOptions from './ButtonWithOptions.jsx';

const REVIEW_SPLIT_GROUP_CLASS =
  'group/split flex w-full min-w-0 items-stretch @min-[36rem]:w-auto';

const REVIEW_PRIMARY_CLASS =
  'inline-flex items-center justify-center gap-1.5 flex-1 min-w-0 whitespace-nowrap px-3 py-1.5 text-sm font-medium';

const REVIEW_CHEVRON_CLASS =
  'inline-flex items-center justify-center shrink-0 py-1.5 text-sm font-medium';

/**
 * Issues-tab control: run a latest-changes review, or send a follow-up message from the caret menu.
 */
export default function ReviewLatestChangesButton({
  disabled,
  loading,
  onReview,
  onSendFollowUpMessage,
  onClearReviewerChat,
}) {
  return (
    <ButtonWithOptions
      type="button"
      disabled={disabled}
      onClick={onReview}
      className={REVIEW_PRIMARY_CLASS}
      chevronClassName={REVIEW_CHEVRON_CLASS}
      groupClassName={REVIEW_SPLIT_GROUP_CLASS}
      menuTitle="Review options"
      menuItems={[
        {
          label: 'Send a follow-up message…',
          hint: 'Add a user message to the reviewer chat and continue the review',
          onSelect: onSendFollowUpMessage,
        },
        {
          label: 'Clear reviewer chat',
          hint: 'Start the next review from a new prompt. Existing issues stay as they are.',
          onSelect: onClearReviewerChat,
        },
      ]}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
      Review latest changes
    </ButtonWithOptions>
  );
}
