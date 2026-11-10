import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  uploadImageAsset,
  fetchRepositoryId,
  uploadImageErrorDetail,
} from '../image-asset-upload.js';

function jsonResponse(status, body, statusText = undefined) {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText ?? body?.message ?? '',
    json: async () => body,
  };
  if (status >= 400) {
    response.json = async () => ({ message: body?.message ?? '' });
  }
  return response;
}

describe('image-asset-upload', () => {
  let worktree;
  let fetchMock;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'image-upload-test-'));
    fs.writeFileSync(path.join(worktree, '546e….png'), 'png-bytes');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  function stubFetch(handler) {
    fetchMock = vi.fn(handler);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const defaultHandler = (url) => {
    if (url.startsWith('https://api.github.com/repos/')) {
      return Promise.resolve(jsonResponse(200, { id: 123456 }));
    }
    return Promise.resolve(
      jsonResponse(201, { url: 'https://github.com/user-attachments/assets/fresh-1' })
    );
  };

  it('resolves the repository numeric id through the REST API', async () => {
    const fetchStub = stubFetch(() => Promise.resolve(jsonResponse(200, { id: 123456 })));

    const id = await fetchRepositoryId({ repoFullName: 'o/r', token: 'tok' });

    expect(id).toBe(123456);
    expect(fetchStub.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r');
    const init = fetchStub.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('uploads the image to the attachments endpoint and returns the asset URL', async () => {
    const fetchStub = stubFetch(defaultHandler);

    const { url } = await uploadImageAsset({
      repoFullName: 'o/r',
      token: 'tok',
      imageFilePath: path.join(worktree, '546e….png'),
      mediaType: 'image/png',
    });

    expect(url).toBe('https://github.com/user-attachments/assets/fresh-1');

    expect(fetchStub).toHaveBeenCalledTimes(2);
    const [uploadUrl, uploadInit] = fetchStub.mock.calls[1];
    expect(uploadUrl).toBe(
      'https://uploads.github.com/user-attachments/assets?name=546e%E2%80%A6.png&content_type=image%2Fpng&repository_id=123456'
    );
    expect(uploadInit.method).toBe('POST');
    expect(uploadInit.headers.Authorization).toBe('Bearer tok');
    expect(uploadInit.headers['Content-Type']).toBe('application/octet-stream');
    expect(Buffer.isBuffer(uploadInit.body)).toBe(true);
  });

  it('names write access when the upload endpoint answers 404', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://api.github.com/repos/')) {
        return Promise.resolve(jsonResponse(200, { id: 123456 }));
      }
      return Promise.resolve(jsonResponse(404, { message: 'Not Found' }));
    });

    await expect(
      uploadImageAsset({
        repoFullName: 'o/r',
        token: 'tok',
        imageFilePath: path.join(worktree, '546e….png'),
        mediaType: 'image/png',
      })
    ).rejects.toThrow(/404 Not Found — attaching files requires write access/);
  });

  it('surfaces the upload error message from the response body', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://api.github.com/repos/')) {
        return Promise.resolve(jsonResponse(200, { id: 123456 }));
      }
      return Promise.resolve(jsonResponse(422, { message: 'Attachment is too large' }));
    });

    await expect(
      uploadImageAsset({
        repoFullName: 'o/r',
        token: 'tok',
        imageFilePath: path.join(worktree, '546e….png'),
        mediaType: 'image/png',
      })
    ).rejects.toThrow(/422 Attachment is too large/);
  });

  it('helpers: error detail keeps non-404 statuses as-is and the repository id fails fast', async () => {
    expect(uploadImageErrorDetail(404, 'Not Found')).toMatch(
      /requires write access to the repository/
    );
    expect(uploadImageErrorDetail(422, 'nope')).toBe('422 nope');

    stubFetch(() => Promise.resolve(jsonResponse(200, { id: null })));
    await expect(fetchRepositoryId({ repoFullName: 'o/r', token: 't' })).rejects.toThrow(
      /Could not resolve the repository id/
    );
  });
});
