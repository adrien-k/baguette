/**
 * Downloading Slack attachments and describing them to the agent.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SlackFileError,
  attachmentsContext,
  downloadSlackFile,
  isTextFile,
  safeFileName,
  slackFilesDir,
} from '../slack-files.js';

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'slack-files-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const response = (body, { status = 200, contentType = 'application/octet-stream' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
  arrayBuffer: async () => Buffer.from(body),
});
const fetchReturning = (...responses) => {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  return fn;
};
const file = (overrides = {}) => ({
  id: 'F1',
  name: 'data.json',
  mimetype: 'application/json',
  filetype: 'json',
  size: 10,
  url: 'https://files.slack.com/F1',
  ...overrides,
});

describe('isTextFile', () => {
  it.each([
    [{ mimetype: 'text/plain' }],
    [{ mimetype: 'application/json' }],
    [{ mimetype: 'image/svg+xml' }],
    [{ filetype: 'csv' }],
    [{ name: 'notes.MD' }],
    [{ name: 'main.py' }],
  ])('treats %j as text', (f) => {
    expect(isTextFile(f)).toBe(true);
  });

  it.each([
    [{ mimetype: 'image/png', name: 'a.png' }],
    [{ mimetype: 'application/pdf', name: 'a.pdf' }],
    [{ name: 'archive.zip' }],
    [{}],
  ])('treats %j as binary', (f) => {
    expect(isTextFile(f)).toBe(false);
  });
});

describe('safeFileName', () => {
  it('keeps a plain name', () => {
    expect(safeFileName('report 2026.csv')).toBe('report 2026.csv');
  });

  it('cannot escape the directory', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('..')).toBe('file');
    expect(safeFileName('a/b\\c?.txt')).not.toMatch(/[/\\?]/);
  });

  it('falls back and limits the length', () => {
    expect(safeFileName(undefined)).toBe('file');
    expect(safeFileName('x'.repeat(300))).toHaveLength(100);
  });
});

describe('slackFilesDir', () => {
  it('is per app and thread, outside any repo', () => {
    expect(slackFilesDir(1, 'C1', '9.9')).toMatch(/slack-files[/\\]1[/\\]C1-9\.9$/);
  });
});

describe('downloadSlackFile', () => {
  const streamed = (chunks, headers = {}) => ({
    ok: true,
    status: 200,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  });

  it('reads a streamed body', async () => {
    const fetchFn = fetchReturning(streamed([Buffer.from('ab'), Buffer.from('cd')]));
    const saved = await downloadSlackFile('t', file(), dir, { fetchFn });
    expect(await fs.readFile(saved.path, 'utf8')).toBe('abcd');
    expect(saved.size).toBe(4);
  });

  it('rejects on content-length before reading the body', async () => {
    const res = streamed([Buffer.from('x')], { 'content-length': String(30 * 1024 * 1024) });
    const cancel = vi.spyOn(res.body, 'cancel');
    await expect(
      downloadSlackFile('t', file({ size: null }), dir, { fetchFn: fetchReturning(res) })
    ).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalled();
  });

  it('stops reading a streamed body once it passes the cap', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024);
    let pulled = 0;
    const res = streamed([]);
    res.body = new ReadableStream({
      pull(controller) {
        pulled += 1;
        controller.enqueue(big);
      },
    });
    await expect(
      downloadSlackFile('t', file({ size: null }), dir, { fetchFn: fetchReturning(res) })
    ).rejects.toThrow(/too large/);
    expect(pulled).toBeLessThan(10);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('gives up on a download that never answers', async () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => AbortSignal.abort(new DOMException('x', 'TimeoutError')));
    const fetchFn = vi.fn((_url, { signal }) => Promise.reject(signal.reason));
    await expect(downloadSlackFile('t', file(), dir, { fetchFn })).rejects.toThrow(/timed out/i);
    timeout.mockRestore();
  });

  it('saves a text file and returns its text', async () => {
    const fetchFn = fetchReturning(response('{"a":1}', { contentType: 'application/json' }));
    const saved = await downloadSlackFile('xoxb-1', file(), dir, { fetchFn });

    expect(fetchFn).toHaveBeenCalledWith('https://files.slack.com/F1', {
      headers: { Authorization: 'Bearer xoxb-1' },
      signal: expect.any(AbortSignal),
    });
    expect(saved.text).toBe('{"a":1}');
    expect(saved.size).toBe(7);
    expect(saved.path).toBe(path.join(dir, 'F1-data.json'));
    expect(await fs.readFile(saved.path, 'utf8')).toBe('{"a":1}');
  });

  it('saves a binary file without text', async () => {
    const fetchFn = fetchReturning(response(Buffer.from([1, 2, 3])));
    const saved = await downloadSlackFile(
      'xoxb-1',
      file({ name: 'pic.png', mimetype: 'image/png', filetype: 'png' }),
      dir,
      { fetchFn }
    );
    expect(saved.text).toBeNull();
    expect((await fs.readFile(saved.path)).length).toBe(3);
  });

  it('refuses a file without a download link (deleted / hidden)', async () => {
    await expect(downloadSlackFile('t', file({ url: null }), dir, {})).rejects.toThrow(
      SlackFileError
    );
  });

  it('refuses a file that is too large, by its declared or actual size', async () => {
    const fetchFn = vi.fn();
    await expect(
      downloadSlackFile('t', file({ size: 30 * 1024 * 1024 }), dir, { fetchFn })
    ).rejects.toThrow(/too large/);
    expect(fetchFn).not.toHaveBeenCalled();

    const big = fetchReturning(response(Buffer.alloc(26 * 1024 * 1024)));
    await expect(
      downloadSlackFile('t', file({ size: null }), dir, { fetchFn: big })
    ).rejects.toThrow(/too large/);
  });

  it('reports HTTP errors', async () => {
    const fetchFn = fetchReturning(response('', { status: 404 }));
    await expect(downloadSlackFile('t', file(), dir, { fetchFn })).rejects.toThrow(/HTTP 404/);
  });

  it('explains a sign-in page — the missing files:read scope — instead of saving it', async () => {
    const fetchFn = fetchReturning(response('<html>sign in</html>', { contentType: 'text/html' }));
    await expect(downloadSlackFile('t', file(), dir, { fetchFn })).rejects.toThrow(/files:read/);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('still saves a genuine html file', async () => {
    const fetchFn = fetchReturning(response('<p>hi</p>', { contentType: 'text/html' }));
    const saved = await downloadSlackFile(
      't',
      file({ name: 'page.html', mimetype: 'text/html', filetype: 'html' }),
      dir,
      { fetchFn }
    );
    expect(saved.text).toBe('<p>hi</p>');
  });

  it('never writes outside the directory', async () => {
    const fetchFn = fetchReturning(response('x'));
    const saved = await downloadSlackFile('t', file({ name: '../../evil.txt' }), dir, { fetchFn });
    expect(path.dirname(saved.path)).toBe(dir);
  });
});

describe('attachmentsContext', () => {
  it('is empty without files', async () => {
    expect(await attachmentsContext('t', [], dir)).toBe('');
    expect(await attachmentsContext('t', undefined, dir)).toBe('');
  });

  it('shows a small text file inline and gives its path', async () => {
    const fetchFn = fetchReturning(response('a,b\n1,2', { contentType: 'text/csv' }));
    const text = await attachmentsContext(
      't',
      [file({ name: 'x.csv', mimetype: 'text/csv', filetype: 'csv' })],
      dir,
      { fetchFn }
    );
    expect(text).toContain('Attached files (downloaded for you)');
    expect(text).toContain('x.csv (text/csv');
    expect(text).toContain(path.join(dir, 'F1-x.csv'));
    expect(text).toContain('```\na,b\n1,2\n```');
  });

  it('only gives the path of a binary file', async () => {
    const fetchFn = fetchReturning(response(Buffer.from([0, 1])));
    const text = await attachmentsContext(
      't',
      [file({ name: 'pic.png', mimetype: 'image/png', filetype: 'png' })],
      dir,
      { fetchFn }
    );
    expect(text).toContain('pic.png');
    expect(text).toContain('open it with your file or image tools');
    expect(text).not.toContain('```');
  });

  it('cuts a long text file and says how much is shown', async () => {
    const fetchFn = fetchReturning(response('x'.repeat(50_000), { contentType: 'text/plain' }));
    const text = await attachmentsContext(
      't',
      [file({ name: 'big.txt', mimetype: 'text/plain', filetype: 'txt', size: 50_000 })],
      dir,
      { fetchFn }
    );
    expect(text).toContain('first 20 KB shown');
    expect(text.length).toBeLessThan(25_000);
  });

  it('uses a longer fence when the content contains one', async () => {
    const fetchFn = fetchReturning(response('```js\nx\n```', { contentType: 'text/plain' }));
    const text = await attachmentsContext(
      't',
      [file({ name: 'a.md', mimetype: 'text/plain', filetype: 'md' })],
      dir,
      { fetchFn }
    );
    expect(text).toContain('````\n```js');
  });

  it('keeps going when one file cannot be downloaded', async () => {
    const fetchFn = fetchReturning(response('', { status: 403 }), response('ok'));
    const text = await attachmentsContext(
      't',
      [
        file({ id: 'F1', name: 'a.txt' }),
        file({ id: 'F2', name: 'b.txt', mimetype: 'text/plain' }),
      ],
      dir,
      { fetchFn }
    );
    expect(text).toContain('a.txt');
    expect(text).toContain('could not be downloaded — Slack answered HTTP 403');
    expect(text).toContain('b.txt');
  });

  it('describes at most five files and mentions the rest', async () => {
    const fetchFn = vi
      .fn()
      .mockImplementation(async () => response('x', { contentType: 'text/plain' }));
    const files = Array.from({ length: 7 }, (_, i) => file({ id: `F${i}`, name: `f${i}.txt` }));
    const text = await attachmentsContext('t', files, dir, { fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(text).toContain('…and 2 more files (SlackDownloadFile)');
  });

  it('stops inlining once the total budget is used up', async () => {
    const fetchFn = vi
      .fn()
      .mockImplementation(async () => response('y'.repeat(20_000), { contentType: 'text/plain' }));
    const files = Array.from({ length: 5 }, (_, i) =>
      file({ id: `F${i}`, name: `f${i}.txt`, mimetype: 'text/plain', size: 20_000 })
    );
    const text = await attachmentsContext('t', files, dir, { fetchFn });
    expect(text.length).toBeLessThan(70_000);
    expect(text).toContain('not shown inline; read it with your file tools');
  });
});
