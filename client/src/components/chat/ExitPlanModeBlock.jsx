import { useState } from 'react';
import MarkdownContent from '../MarkdownContent.jsx';
import { messagesService, sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';

function planInputToMarkdown(input) {
  if (!input) return null;
  for (const key of ['plan', 'description', 'content', 'text', 'summary']) {
    if (typeof input[key] === 'string' && input[key].trim()) return input[key];
  }
  if (Array.isArray(input.allowedPrompts) && input.allowedPrompts.length > 0) {
    return `**Allowed actions:**\n\n${input.allowedPrompts.map((p) => `- ${p.prompt}`).join('\n')}`;
  }
  return '```json\n' + JSON.stringify(input, null, 2) + '\n```';
}

export default function ExitPlanModeBlock({ block, sessionId, userReplied = false }) {
  const [continuePlanning, setContinuePlanning] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const planMarkdown = planInputToMarkdown(block.input);
  const hasResult = userReplied;

  const sendMsg = (text) =>
    messagesService.create({
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: text } }),
    });

  const handleRun = async () => {
    setLoading(true);
    try {
      await sessionsService.patch(sessionId, { plan_mode: false });
      await sendMsg('Proceed with the plan.');
    } catch (err) {
      toastError('Failed to run plan', err);
      setLoading(false);
    }
  };

  const handleContinueSubmit = async () => {
    const text = feedback.trim() || 'Please continue planning and refine the plan further.';
    setLoading(true);
    try {
      await sendMsg(text);
      setContinuePlanning(false);
      setFeedback('');
    } catch (err) {
      toastError('Failed to send feedback', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-brand/20 bg-soft-accent/10 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 border-b border-brand/10">
        <p className="text-xs text-accent/70">Plan ready for review</p>
      </div>
      <div className="px-3 sm:px-4 py-3 overflow-auto max-h-[50vh]">
        {planMarkdown ? (
          <MarkdownContent>{planMarkdown}</MarkdownContent>
        ) : (
          <p className="text-sm text-faint italic">No plan content.</p>
        )}
      </div>
      {!hasResult && (
        <div className="px-3 sm:px-4 pb-3 space-y-2">
          {continuePlanning ? (
            <>
              <textarea
                autoFocus
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleContinueSubmit();
                  if (e.key === 'Escape') {
                    setContinuePlanning(false);
                    setFeedback('');
                  }
                }}
                placeholder="What should Claude refine? (optional)"
                className="w-full px-3 py-2 bg-control border border-strong text-fg rounded-lg text-sm resize-none focus:outline-none focus:border-faint placeholder-faint"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleContinueSubmit}
                  disabled={loading}
                  className="px-4 py-2 bg-track hover:bg-faint disabled:opacity-50 text-fg rounded-lg text-sm font-medium transition-colors"
                >
                  Send feedback
                </button>
                <button
                  onClick={() => {
                    setContinuePlanning(false);
                    setFeedback('');
                  }}
                  className="px-4 py-2 bg-control hover:bg-control-hover text-fg-muted rounded-lg text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-3">
              <button onClick={handleRun} disabled={loading} className={SECONDARY_BUTTON_CLASS}>
                Run
              </button>
              <button
                onClick={() => setContinuePlanning(true)}
                disabled={loading}
                className="px-4 py-2 bg-control-hover hover:bg-track disabled:opacity-50 text-fg rounded-lg text-sm font-medium transition-colors"
              >
                Continue planning
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
