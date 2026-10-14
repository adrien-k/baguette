import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiFetch } from '../../api.js';
import { SettingsSection, SettingsTabHeader } from '../../components/SettingsSection.jsx';
import MarkdownContent from '../../components/MarkdownContent.jsx';
import { TEXT_PRIMARY } from '../../utils/ui.js';

function promptSectionDescription(agentLine, filename) {
  const path = `.baguette/agents/${filename}`;
  return (
    <>
      {agentLine} Extend with <code className={`text-xs font-medium ${TEXT_PRIMARY}`}>{path}</code>{' '}
      in your repos.
    </>
  );
}

function PromptPreview({ markdown }) {
  return (
    <div className="w-full bg-page border border-line rounded-lg px-3 py-2 min-h-[28rem] max-h-[50vh] overflow-auto cursor-default">
      {markdown ? (
        <MarkdownContent>{markdown}</MarkdownContent>
      ) : (
        <p className="text-xs text-faint">Loading…</p>
      )}
    </div>
  );
}

export default function PromptsSettingsTab() {
  const { hash } = useLocation();
  const builderCardRef = useRef(null);
  const subagentCardRef = useRef(null);
  const reviewCardRef = useRef(null);

  const [fullSessionPrompt, setFullSessionPrompt] = useState('');
  const [fullSubagentPrompt, setFullSubagentPrompt] = useState('');
  const [fullReviewPrompt, setFullReviewPrompt] = useState('');

  useEffect(() => {
    const scrollReview = hash === '#settings-prompt-review';
    const scrollBuilder =
      hash === '#settings-prompt-session' || hash === '#settings-prompt-builder';
    const scrollSubagent = hash === '#settings-prompt-subagent';
    if (!scrollReview && !scrollBuilder && !scrollSubagent) return;
    const target = scrollReview ? reviewCardRef : scrollSubagent ? subagentCardRef : builderCardRef;
    const timer = window.setTimeout(() => {
      target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [hash]);

  useEffect(() => {
    apiFetch('/api/settings/prompt-templates')
      .then((d) => {
        setFullSessionPrompt(d.session || '');
        setFullSubagentPrompt(d.subagent || '');
        setFullReviewPrompt(d.review || '');
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <SettingsTabHeader title="Prompts">
        Read-only view of Baguette&apos;s built-in system prompts.
      </SettingsTabHeader>

      <div className="space-y-4">
        <div ref={builderCardRef} id="settings-prompt-builder" className="scroll-mt-6">
          <SettingsSection
            title="Builder"
            description={promptSectionDescription(
              'Primary (Main) builder and manually added builders in the Agents panel.',
              'builder.md'
            )}
          >
            <PromptPreview markdown={fullSessionPrompt} />
          </SettingsSection>
        </div>

        <div ref={subagentCardRef} id="settings-prompt-subagent" className="scroll-mt-6">
          <SettingsSection
            title="Subagent"
            description={promptSectionDescription(
              'Agents created via MCP StartSubagent.',
              'subagent.md'
            )}
          >
            <PromptPreview markdown={fullSubagentPrompt} />
          </SettingsSection>
        </div>

        <div ref={reviewCardRef} id="settings-prompt-review" className="scroll-mt-6">
          <SettingsSection
            title="Review"
            description={promptSectionDescription(
              'Reviewer agent runs started from the session Issues tab.',
              'reviewer.md'
            )}
          >
            <PromptPreview markdown={fullReviewPrompt} />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
