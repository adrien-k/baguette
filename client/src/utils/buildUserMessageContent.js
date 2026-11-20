import { fileToContentBlock } from './fileToContentBlock.js';

/** User message `content` for text plus optional file attachments (composer / add-builder). */
export async function buildUserMessageContent(text, filesToSend = []) {
  const files = Array.isArray(filesToSend) ? filesToSend : [];
  if (files.length) {
    const fileBlocks = await Promise.all(files.map(fileToContentBlock));
    return text ? [{ type: 'text', text }, ...fileBlocks] : fileBlocks;
  }
  return text;
}
