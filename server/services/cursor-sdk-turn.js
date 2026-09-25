import { formatCursorToolCallResult } from '../../shared/cursor-tool-call-result.js';

/**
 * Stream one Cursor SDK run: buffer assistant/thinking chunks, persist tool calls.
 * Shared by cursor-agent sessions and review turns.
 *
 * @param {import('@cursor/sdk').Run} run
 * @param {{
 *   persistMessage: (message: object) => Promise<{ id?: number }>,
 *   patchMessage: (id: number, message: object) => Promise<void>,
 *   onUsage?: (sdkMsg: object) => void,
 *   onStatus?: (sdkMsg: object) => Promise<{ break: boolean, finishedOk?: boolean } | void>,
 *   abortSignal?: AbortSignal,
 * }} options
 * @returns {Promise<{ finishedOk: boolean, hasBackgroundTask: boolean }>}
 */
export async function processCursorRunStream(run, options) {
  const { persistMessage, patchMessage, onUsage, onStatus, abortSignal } = options;
  const pendingToolCalls = new Map();
  let finishedOk = false;
  let hasBackgroundTask = false;

  let streamBuffer = null;

  const flushStreamBuffer = async () => {
    if (!streamBuffer) return;
    if (streamBuffer.kind === 'assistant') {
      await persistMessage(streamBuffer.msg);
    } else {
      await persistMessage({
        type: 'assistant',
        agent_id: streamBuffer.agentId,
        run_id: streamBuffer.runId,
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: streamBuffer.text }],
        },
      });
    }
    streamBuffer = null;
  };

  const normalizeAndPersist = async (sdkMsg) => {
    if (sdkMsg.type === 'tool_call') {
      if (sdkMsg.status === 'running') {
        if (!pendingToolCalls.has(sdkMsg.call_id)) {
          const persistedMsg = await persistMessage({
            type: 'assistant',
            agent_id: sdkMsg.agent_id,
            run_id: sdkMsg.run_id,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: sdkMsg.call_id,
                  name: sdkMsg.name,
                  input: sdkMsg.args ?? {},
                },
              ],
            },
          });
          pendingToolCalls.set(sdkMsg.call_id, {
            name: sdkMsg.name,
            args: sdkMsg.args,
            agentId: sdkMsg.agent_id,
            runId: sdkMsg.run_id,
            persistedMsgId: persistedMsg.id,
          });
        } else {
          const pending = pendingToolCalls.get(sdkMsg.call_id);
          pendingToolCalls.set(sdkMsg.call_id, {
            ...pending,
            name: sdkMsg.name ?? pending.name,
            args: sdkMsg.args ?? pending.args,
          });
        }
      } else {
        const pending = pendingToolCalls.get(sdkMsg.call_id);
        const finalName = pending?.name ?? sdkMsg.name;
        const finalArgs = pending?.args ?? sdkMsg.args ?? {};

        const finalToolUse = {
          type: 'assistant',
          agent_id: pending?.agentId ?? sdkMsg.agent_id,
          run_id: pending?.runId ?? sdkMsg.run_id,
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: sdkMsg.call_id, name: finalName, input: finalArgs }],
          },
        };

        if (pending?.persistedMsgId) {
          await patchMessage(pending.persistedMsgId, finalToolUse);
        } else {
          await persistMessage(finalToolUse);
        }

        const { content: resultContent, isError } = formatCursorToolCallResult(sdkMsg.result, {
          toolCallStatus: sdkMsg.status,
        });

        await persistMessage({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: sdkMsg.call_id,
                content: resultContent,
                is_error: isError,
              },
            ],
          },
        });

        pendingToolCalls.delete(sdkMsg.call_id);
      }
      return;
    }

    if (sdkMsg.type === 'task') {
      if (sdkMsg.text) {
        await persistMessage({
          type: 'system',
          subtype: 'task',
          task_status: sdkMsg.status ?? null,
          text: sdkMsg.text,
        });
      }
      return;
    }

    if (sdkMsg.type === 'request') {
      await persistMessage({
        type: 'system',
        subtype: 'request',
        request_id: sdkMsg.request_id,
      });
    }
  };

  for await (const sdkMsg of run.stream()) {
    if (abortSignal?.aborted) break;

    if (sdkMsg.type === 'assistant') {
      if (streamBuffer?.kind !== 'assistant') {
        await flushStreamBuffer();
        streamBuffer = {
          kind: 'assistant',
          msg: {
            ...sdkMsg,
            message: {
              ...sdkMsg.message,
              content: sdkMsg.message.content.map((b) => ({ ...b })),
            },
          },
        };
      } else {
        for (const block of sdkMsg.message.content) {
          if (block.type === 'text') {
            const existing = streamBuffer.msg.message.content.find((b) => b.type === 'text');
            if (existing) {
              existing.text += block.text;
            } else {
              streamBuffer.msg.message.content.push({ ...block });
            }
          } else {
            streamBuffer.msg.message.content.push({ ...block });
          }
        }
      }
      continue;
    }

    if (sdkMsg.type === 'thinking') {
      if (streamBuffer?.kind !== 'thinking') {
        await flushStreamBuffer();
        streamBuffer = {
          kind: 'thinking',
          agentId: sdkMsg.agent_id,
          runId: sdkMsg.run_id,
          text: sdkMsg.text ?? '',
        };
      } else {
        streamBuffer.text += sdkMsg.text ?? '';
      }
      continue;
    }

    await flushStreamBuffer();

    if (sdkMsg.type === 'task') hasBackgroundTask = true;

    if (sdkMsg.type === 'usage') {
      onUsage?.(sdkMsg);
    }

    await normalizeAndPersist(sdkMsg);

    if (sdkMsg.type === 'status' && onStatus) {
      const result = await onStatus(sdkMsg);
      if (result?.break) {
        if (result.finishedOk) finishedOk = true;
        break;
      }
    }
  }

  await flushStreamBuffer();
  return { finishedOk, hasBackgroundTask };
}
