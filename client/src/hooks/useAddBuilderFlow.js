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
  const [initialFiles, setInitialFiles] = useState([]);
  const [adding, setAdding] = useState(false);
  const [composerClearNonce, setComposerClearNonce] = useState(0);
  const recipes = useSessionChatRecipes(session, modelAgent);
  const openedFromComposerRef = useRef(false);

  const openModal = useCallback((arg = '') => {
    if (arg && typeof arg === 'object') {
      const prompt = typeof arg.prompt === 'string' ? arg.prompt : '';
      setInitialPrompt(prompt);
      setInitialFiles(Array.isArray(arg.files) ? [...arg.files] : []);
      openedFromComposerRef.current = Boolean(arg.fromComposer);
    } else {
      setInitialPrompt(typeof arg === 'string' ? arg : '');
      setInitialFiles([]);
      openedFromComposerRef.current = false;
    }
    setModalKey((k) => k + 1);
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (adding) return;
    openedFromComposerRef.current = false;
    setOpen(false);
  }, [adding]);

  const handleConfirm = useCallback(
    async ({ name, prompt, agent_config_id, model, model_params, files: modalFiles = [] }) => {
      if (!session?.id || adding) return;
      const label = typeof name === 'string' ? name.trim() : '';
      if (!label) return;
      const text = typeof prompt === 'string' ? prompt.trim() : '';
      const files = Array.isArray(modalFiles) ? modalFiles : [];

      setAdding(true);

      let messageContent = null;
      if (text || files.length) {
        try {
          messageContent = await buildUserMessageContent(text, files);
        } catch (err) {
          setAdding(false);
          return {
            ok: false,
            fileError: err?.message ?? 'Failed to read attached files',
          };
        }
      }

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
        return { ok: false };
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

      if (messageContent != null) {
        const fromComposer = openedFromComposerRef.current;
        try {
          const messageJson = JSON.stringify({
            type: 'user',
            message: { role: 'user', content: messageContent },
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

      openedFromComposerRef.current = false;
      setAdding(false);
      return { ok: true };
    },
    [session, adding, onSelectAgent]
  );

  return {
    open,
    modalKey,
    initialPrompt,
    initialFiles,
    initialLabel: titleFromPrompt(initialPrompt),
    adding,
    composerClearNonce,
    recipes,
    openModal,
    closeModal,
    handleConfirm,
  };
}
