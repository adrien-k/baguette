import { claudeBuildToolCallComplete, claudeBuildToolCallStart } from './mapping.ts';
import { createClaudeTaskTracker } from './task-tracker.js';
import { hasNonemptyToolInput } from '../../../shared/merge-tool-call-input.js';

/**
 * Claude message-stream tool-call builders. A fresh task tracker is created per
 * call — message-writer-factory calls `toolCallBuilders()` once per writer.
 */
export function claudeToolCallBuilders() {
  const taskTracker = createClaudeTaskTracker();
  return {
    buildToolCallStart: (
      callId: string,
      name: string,
      args: Record<string, unknown>,
      startedAt?: string
    ) => {
      const input = args.taskId != null ? taskTracker.enrichTaskUpdateInput(args) : args;
      return claudeBuildToolCallStart(callId, name, input, startedAt);
    },
    buildToolCallComplete: (prev, opts) => {
      const rawArgs = opts.args;
      const isTaskUpdate = rawArgs != null && rawArgs.taskId != null;
      const isTaskCreate =
        rawArgs != null &&
        !isTaskUpdate &&
        (typeof rawArgs.subject === 'string' || typeof rawArgs.description === 'string');
      const input =
        rawArgs != null && isTaskUpdate ? taskTracker.enrichTaskUpdateInput(rawArgs) : rawArgs;
      const completeArgs = input != null && hasNonemptyToolInput(input) ? input : undefined;
      const completed = claudeBuildToolCallComplete(prev, {
        ...opts,
        args: completeArgs,
      });
      if (isTaskCreate) {
        taskTracker.registerTaskFromCreateResult(opts.rawResult, rawArgs);
      }
      return completed;
    },
  };
}
