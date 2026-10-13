import { useEffect } from 'react';
import { messagesService } from '../feathers.js';
import {
  isFileMutatingToolCall,
  isTerminalToolCall,
} from '@baguette/shared/file-mutating-tools.js';

/** Mark session diff stale when create/edit/write tools finish (no live refetch). */
export function useMarkSessionDiffStaleOnFileTools(sessionId, markStale) {
  useEffect(() => {
    if (!sessionId || !markStale) return;

    const consider = (message) => {
      if (message.session_id !== sessionId) return;
      if (!isFileMutatingToolCall(message)) return;
      if (!isTerminalToolCall(message)) return;
      markStale();
    };

    messagesService.on('created', consider);
    messagesService.on('patched', consider);
    return () => {
      messagesService.off('created', consider);
      messagesService.off('patched', consider);
    };
  }, [sessionId, markStale]);
}
