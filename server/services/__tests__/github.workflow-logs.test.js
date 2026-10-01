import { describe, it, expect, vi, beforeEach } from 'vitest';

const githubFetch = vi.fn();

vi.mock('../github-api.js', () => ({
  githubFetch: (...args) => githubFetch(...args),
}));

import { getPRWorkflowLogs } from '../github.js';

describe('getPRWorkflowLogs', () => {
  beforeEach(() => {
    githubFetch.mockReset();
  });

  it('fetches job log bytes from the signed redirect URL without GitHub auth', async () => {
    const blobUrl =
      'https://productionresultssa13.blob.core.windows.net/actions-results/abc?sig=signed';

    githubFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobs: [{ id: 99, name: 'test', status: 'completed', conclusion: 'failure' }],
          }),
          {
            status: 200,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response('', {
          status: 302,
          headers: { location: blobUrl },
        })
      )
      .mockResolvedValueOnce(
        new Response('error: build failed\n', {
          status: 206,
          headers: { 'content-range': 'bytes 0-19/20' },
        })
      );

    const result = await getPRWorkflowLogs('gho_token', 'owner/repo', '12345');

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].log).toBe('error: build failed\n');

    expect(githubFetch).toHaveBeenCalledTimes(3);
    const logBlobCall = githubFetch.mock.calls[2];
    expect(logBlobCall[0]).toBe(blobUrl);
    expect(logBlobCall[1]).not.toHaveProperty('token');
    expect(logBlobCall[1].headers?.Range ?? logBlobCall[1].headers?.get?.('Range')).toBeDefined();
  });
});
