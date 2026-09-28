import { useState } from 'react';
import { messagesService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';

function buildAnswerMessage(questions, answers) {
  return questions
    .map((q, i) => {
      const ans = answers[i];
      let value;
      if (q.multiSelect) {
        const parts = [...ans.selected].map((l) => (l === 'Other' ? ans.otherText || 'Other' : l));
        value = parts.join(', ');
      } else {
        value = ans.selected === 'Other' ? ans.otherText || 'Other' : (ans.selected ?? '');
      }
      return `**${q.question}**: ${value}`;
    })
    .join('\n');
}

function isAnswerComplete(questions, answers) {
  return questions.every((q, i) => {
    const ans = answers[i];
    if (q.multiSelect)
      return ans.selected.size > 0 && (!ans.selected.has('Other') || ans.otherText.trim());
    return ans.selected && (ans.selected !== 'Other' || ans.otherText.trim());
  });
}

export default function AskUserQuestionBlock({ block, sessionId, userReplied = false }) {
  const questions = block.input?.questions ?? [];
  const hasResult = userReplied;

  const [answers, setAnswers] = useState(() =>
    questions.map((q) => ({ selected: q.multiSelect ? new Set() : null, otherText: '' }))
  );
  const [loading, setLoading] = useState(false);

  const sendMsg = (text) =>
    messagesService.create({
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: text } }),
    });

  const toggle = (i, label) => {
    setAnswers((prev) => {
      const ans = prev[i];
      const q = questions[i];
      let next;
      if (q.multiSelect) {
        const s = new Set(ans.selected);
        s.has(label) ? s.delete(label) : s.add(label);
        next = { ...ans, selected: s };
      } else {
        next = { ...ans, selected: label };
      }
      const newAnswers = prev.map((a, idx) => (idx === i ? next : a));
      // Auto-submit single-select with no Other
      const allSingle = questions.every((q2) => !q2.multiSelect);
      const noOther = newAnswers.every((a) => a.selected !== 'Other');
      if (allSingle && noOther && isAnswerComplete(questions, newAnswers)) {
        submit(newAnswers);
      }
      return newAnswers;
    });
  };

  const submit = async (answersToUse = answers) => {
    if (!isAnswerComplete(questions, answersToUse)) return;
    setLoading(true);
    try {
      await sendMsg(buildAnswerMessage(questions, answersToUse));
    } catch (err) {
      toastError('Failed to send answers', err);
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-brand/20 bg-soft-accent/10 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 border-b border-brand/10">
        <p className="text-xs text-accent/70">Claude has a question</p>
      </div>
      <div className="px-3 sm:px-4 py-3 space-y-4">
        {questions.map((q, i) => {
          const ans = answers[i];
          const allOptions = [
            ...(q.options ?? []),
            { label: 'Other', description: 'Enter a custom answer' },
          ];
          return (
            <div key={i}>
              <div className="text-sm font-medium text-fg mb-2">{q.question}</div>
              <div className="space-y-1.5">
                {allOptions.map((opt) => {
                  const selected = q.multiSelect
                    ? ans.selected.has(opt.label)
                    : ans.selected === opt.label;
                  return (
                    <button
                      key={opt.label}
                      onClick={() => !hasResult && toggle(i, opt.label)}
                      disabled={hasResult || loading}
                      className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-default ${
                        selected
                          ? 'bg-brand/20 border-brand text-fg'
                          : 'bg-control border-strong text-secondary hover:border-faint disabled:hover:border-strong'
                      }`}
                    >
                      <div className="font-medium">{opt.label}</div>
                      {opt.description && (
                        <div className="text-xs text-faint mt-0.5">{opt.description}</div>
                      )}
                    </button>
                  );
                })}
              </div>
              {(q.multiSelect ? ans.selected.has('Other') : ans.selected === 'Other') &&
                !hasResult && (
                  <input
                    autoFocus
                    type="text"
                    value={ans.otherText}
                    onChange={(e) =>
                      setAnswers((prev) =>
                        prev.map((a, idx) => (idx === i ? { ...a, otherText: e.target.value } : a))
                      )
                    }
                    placeholder="Your answer…"
                    className="mt-2 w-full bg-control border border-strong rounded-lg px-3 py-2 text-sm text-fg placeholder-faint focus:outline-none focus:border-faint"
                  />
                )}
            </div>
          );
        })}
      </div>
      {!hasResult &&
        (!questions.every((q) => !q.multiSelect) ||
          answers.some((a) => a.selected === 'Other')) && (
          <div className="px-3 sm:px-4 pb-3">
            <button
              onClick={() => submit()}
              disabled={!isAnswerComplete(questions, answers) || loading}
              className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-on-brand rounded-lg text-sm font-medium transition-colors"
            >
              Submit
            </button>
          </div>
        )}
    </div>
  );
}
