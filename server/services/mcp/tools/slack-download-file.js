import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { slackHandler, createSlackHelpers } from '../lib/slack.js';
import { getFileInfo } from '../../slack.js';
import { SlackFileError, downloadSlackFile, slackSessionFilesDir } from '../../slack-files.js';

const MAX_PREVIEW_CHARS = 50_000;

export function createSlackDownloadFileTool(ctx) {
  const slack = createSlackHelpers(ctx);
  return {
    name: 'SlackDownloadFile',
    description:
      'Download a file attached in Slack (json, txt, csv, svg, images, pdf, …) and get its local ' +
      'path. Text-like files also come back as `text` (first ' +
      `${MAX_PREVIEW_CHARS / 1000}k characters). Files attached to the message that reached you are ` +
      'already downloaded for you; use this for files elsewhere — SlackReadThread and ' +
      'SlackReadChannel list each message’s `files` with their ids. Open images and other binary ' +
      'files from the returned path with your file tools.',
    schema: {
      file_id: z.string().describe('Slack file id (F…), from the `files` of a message'),
      app: z.string().optional().describe(`Slack app to download as. ${slack.slackAppHint}`),
    },
    handler: slackHandler(async ({ file_id: fileId, app: appName }) => {
      const bound = await slack.getBoundThread();
      let slackApp;
      if (bound && !appName) {
        const apps = await slack.loadSlackApps();
        slackApp = apps.find((a) => a.id === bound.slack_app_id);
      }
      slackApp ??= await slack.resolveSlackApp(appName);

      try {
        const file = await getFileInfo(slackApp.bot_token, fileId);
        await slack.assertMayReadFile(slackApp, file);
        const sessionId = (await slack.getSession())?.id ?? 'unknown';
        const dir = slackSessionFilesDir(sessionId);
        const saved = await downloadSlackFile(slackApp.bot_token, file, dir);
        return ok({
          name: file.name,
          mimetype: file.mimetype,
          size: saved.size,
          path: saved.path,
          ...(saved.text == null
            ? {}
            : {
                text: saved.text.slice(0, MAX_PREVIEW_CHARS),
                truncated: saved.text.length > MAX_PREVIEW_CHARS,
              }),
        });
      } catch (err) {
        if (err instanceof SlackFileError)
          return fail(`Could not download the file: ${err.message}`);
        if (['file_not_found', 'missing_scope'].includes(err.slackError)) {
          return fail(
            `Could not read that file (${err.slackError}). Check the id, or that the app has the files:read scope.`
          );
        }
        throw err;
      }
    }),
  };
}
