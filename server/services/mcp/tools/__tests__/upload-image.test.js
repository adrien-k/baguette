import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MAX_SESSION_IMAGE_BYTES } from '../../../../../shared/session-images.js';

import { createUploadImageTool } from '../upload-image.js';

function payload(result) {
  return JSON.parse(result.content[0].text);
}

describe('UploadImage MCP tool (persist + placeholder)', () => {
  let worktree;
  let createRow;
  let app;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'baguette-upload-test-'));
    createRow = vi.fn().mockResolvedValue({
      id: 5,
      session_id: 99,
      image_slug: 'abc-123',
      file_ext: '.png',
      media_type: 'image/png',
      alt_text: 'screenshot',
      github_url: null,
    });
    app = {
      service: (name) => {
        if (name !== 'session-images') throw new Error(`unexpected service: ${name}`);
        return { create: createRow };
      },
    };
  });

  afterEach(() => {
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  function createTool(overrides = {}) {
    const ctx = {
      getSession: async () => ({
        id: 99,
        user_id: 3,
        repo_id: 1,
        repo_full_name: 'acme/app',
      }),
      app,
      absoluteSessionPath: worktree,
      ...overrides,
    };
    return createUploadImageTool(ctx);
  }

  it('persists a worktree file and returns the placeholder', async () => {
    const screenshots = path.join(worktree, 'screenshots');
    fs.mkdirSync(screenshots);
    fs.writeFileSync(path.join(screenshots, 'after.png'), 'png-bytes');

    const tool = createTool();
    const result = payload(
      await tool.handler({ filePath: 'screenshots/after.png', altText: 'after state' })
    );

    expect(result.ok).toBe(true);
    expect(result.image_id).toBe('abc-123');
    expect(result.placeholder).toBe('{{image:abc-123}}');
    expect(result.markdown).toBe('{{image:abc-123}}');

    expect(createRow).toHaveBeenCalledTimes(1);
    const args = createRow.mock.calls[0][0];
    expect(args.session_id).toBe(99);
    expect(args.media_type).toBe('image/png');
    expect(args.alt_text).toBe('after state');
    expect(Buffer.isBuffer(args.bytes)).toBe(true);
    expect(args.bytes.toString()).toBe('png-bytes');
    const internalParams = createRow.mock.calls[0][1];
    expect(internalParams).toMatchObject({ provider: undefined, user: { id: 3 } });
  });

  it('normalizes alt text and derives media type from the extension', async () => {
    fs.writeFileSync(path.join(worktree, 'cap_01.jpeg'), 'jpeg');

    await createTool().handler({ filePath: 'cap_01.jpeg', altText: '  before\n\nafter  ' });

    const args = createRow.mock.calls[0][0];
    expect(args.media_type).toBe('image/jpeg');
    expect(args.alt_text).toBe('before after');
  });

  it('falls back to the filename when alt text is missing', async () => {
    fs.writeFileSync(path.join(worktree, 'cap_01.png'), 'png');
    await createTool().handler({ filePath: 'cap_01.png' });
    expect(createRow.mock.calls[0][0].alt_text).toBe('');
  });

  it('persists base64 payloads without touching the worktree', async () => {
    const tool = createTool();
    const result = payload(
      await tool.handler({
        base64: Buffer.from('png-bytes').toString('base64'),
        mediaType: 'image/png',
      })
    );

    expect(result.ok).toBe(true);
    const args = createRow.mock.calls[0][0];
    expect(args.bytes.toString()).toBe('png-bytes');
    expect(fs.readdirSync(worktree)).toEqual([]);
  });

  it('surfaces service failures for oversized uploads', async () => {
    createRow.mockRejectedValue(
      Object.assign(new Error(`Image is too large (${(20).toFixed(1)} MB)`), {})
    );
    const tool = createTool();
    const result = payload(
      await tool.handler({ base64: Buffer.alloc(21).toString('base64'), mediaType: 'image/gif' })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Could not store the image/);
  });

  it('prefilters oversize payloads after reading a file', async () => {
    createRow.mockClear();
    fs.writeFileSync(path.join(worktree, 'big.png'), Buffer.alloc(MAX_SESSION_IMAGE_BYTES + 1));
    const result = payload(await createTool().handler({ filePath: 'big.png' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too large/);
    expect(createRow).not.toHaveBeenCalled();
  });

  it('prefilters empty image payloads', async () => {
    fs.writeFileSync(path.join(worktree, 'empty.png'), '');
    const result = payload(await createTool().handler({ filePath: 'empty.png' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
    expect(createRow).not.toHaveBeenCalled();
  });

  it('refuses filePath outside the worktree', async () => {
    const result = payload(await createTool().handler({ filePath: '../outside.png' }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('filePath must be within the worktree');
    expect(createRow).not.toHaveBeenCalled();
  });

  it('refuses unsupported extensions and unknown media types', async () => {
    fs.writeFileSync(path.join(worktree, 'deck.pdf'), 'pdf');
    expect(payload(await createTool().handler({ filePath: 'deck.pdf' })).error).toMatch(
      /Unsupported image extension/
    );
    expect(
      payload(await createTool().handler({ base64: 'eA==', mediaType: 'image/svg+xml' })).error
    ).toMatch(/Unsupported mediaType/);
    expect(createRow).not.toHaveBeenCalled();
  });

  it('refuses a missing worktree image', async () => {
    expect(payload(await createTool().handler({ filePath: 'nope.png' })).error).toMatch(
      /Could not read file/
    );
    expect(createRow).not.toHaveBeenCalled();
  });

  it('requires filePath or base64 + mediaType', async () => {
    const tool = createTool();
    expect(payload(await tool.handler({})).error).toBe(
      'Provide either filePath or base64 + mediaType'
    );
    expect(payload(await tool.handler({ base64: 'eA==' })).error).toBe(
      'Provide either filePath or base64 + mediaType'
    );
    expect(createRow).not.toHaveBeenCalled();
  });

  it('requires a repository session', async () => {
    const tool = createTool({ getSession: async () => ({ id: 99, user_id: 3 }) });
    const result = payload(
      await tool.handler({ base64: Buffer.from('x').toString('base64'), mediaType: 'image/png' })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/repository sessions/);
    expect(createRow).not.toHaveBeenCalled();
  });
});
