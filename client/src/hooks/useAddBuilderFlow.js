import { useState, useCallback, useRef } from 'react';
import { titleFromPrompt } from '@baguette/shared/agent-naming.js';
import { agentsService, messagesService, sessionsService } from '../feathers.js';
import { toastError, toastFeathersError } from '../utils/toastError.jsx';
import { builderMessageCreateFields } from '../utils/messageCreateFields.js';
import { buildUserMessageContent } from '../utils/buildUserMessageContent.js';
import { useSessionChatRecipes } from './useSessionChatRecipes.js';

/**
 * Add-builder modal + create agent, pin, optional first message (empty prompt = no message).
 */
export function useAddBuilderFlow({ session, modelAgent, onSelectAgent }) {
  const [open, setOpen] = useState(false);
  const [modalKey, setModalKey] = useState(0);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [adding, setAdding] = useState(false);
  const [composerClearNonce, setComposerClearNonce] = useState(0);
  const recipes = useSessionChatRecipes(session, modelAgent);
  const composerFilesRef = useRef([]);
  const openedFromComposerRef = useRef(false);

  const openModal = useCallback((arg = '') => {
    if (arg && typeof arg === 'object') {
      const prompt = typeof arg.prompt === 'string' ? arg.prompt : '';
      setInitialPrompt(prompt);
      composerFilesRef.current = Array.isArray(arg.files) ? [...arg.files] : [];
      openedFromComposerRef.current = Boolean(arg.fromComposer);
    } else {
      setInitialPrompt(typeof arg === 'string' ? arg : '');
      composerFilesRef.current = [];
      openedFromComposerRef.current = false;
    }
    setModalKey((k) => k + 1);
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (adding) return;
    composerFilesRef.current = [];
    openedFromComposerRef.current = false;
    setOpen(false);
  }, [adding]);

  const handleConfirm = useCallback(
    async ({ name, prompt, agent_config_id, model, model_params }) => {
      if (!session?.id || adding) return;
      const label = typeof name === 'string' ? name.trim() : '';
      if (!label) return;
      const text = typeof prompt === 'string' ? prompt.trim() : '';

      setAdding(true);
      let newAgent;
      try {
        const payload = {
          session_id: session.id,
          agent_type: 'builder',
          name: label,
        };
        if (agent_config_id != null) payload.agent_config_id = agent_config_id;
        if (model) payload.model = model;
        if (model_params !== undefined) payload.model_params = model_params;
        newAgent = await agentsService.create(payload);
      } catch (err) {
        toastFeathersError('Failed to add builder', err);
        setAdding(false);
        return;
      }

      setOpen(false);

      if (newAgent?.id != null) {
        try {
          await sessionsService.patch(session.id, { pinned_agent_id: newAgent.id });
        } catch (err) {
          toastError('Failed to pin new builder', err);
        }
        onSelectAgent?.(newAgent);
      }

      if (text) {
        const fromComposer = openedFromComposerRef.current;
        const composerFiles = composerFilesRef.current;
        try {
          const content = await buildUserMessageContent(text, composerFiles);
          const messageJson = JSON.stringify({
            type: 'user',
            message: { role: 'user', content },
          });
          await messagesService.create({
            session_id: session.id,
            type: 'user',
            message_json: messageJson,
            ...builderMessageCreateFields(session, {
              model,
              model_params,
              agent: newAgent,
            }),
          });
          if (fromComposer) {
            setComposerClearNonce((n) => n + 1);
          }
        } catch (err) {
          toastFeathersError('Failed to send message', err);
        }
      }

      composerFilesRef.current = [];
      openedFromComposerRef.current = false;
      setAdding(false);
    },
    [session, adding, onSelectAgent]
  );

  return {
    open,
    modalKey,
    initialPrompt,
    initialLabel: titleFromPrompt(initialPrompt),
    adding,
    composerClearNonce,
    recipes,
    openModal,
    closeModal,
    handleConfirm,
  };
}
