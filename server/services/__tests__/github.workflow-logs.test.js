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

  it('fetches only the requested job by name', async () => {
    const blobUrl = 'https://blob.example/log';

    githubFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobs: [
              { id: 1, name: 'lint', status: 'completed', conclusion: 'success' },
              { id: 2, name: 'rust-tests', status: 'completed', conclusion: 'failure' },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response('', { status: 302, headers: { location: blobUrl } }))
      .mockResolvedValueOnce(
        new Response('rustc error', {
          status: 206,
          headers: { 'content-range': 'bytes 0-10/11' },
        })
      );

    const result = await getPRWorkflowLogs('tok', 'owner/repo', '12345', { jobName: 'rust-tests' });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].name).toBe('rust-tests');
    expect(githubFetch).toHaveBeenCalledTimes(3);
  });

  it('throws when jobId matches no job in the run', async () => {
    githubFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jobs: [{ id: 1, name: 'lint', status: 'completed', conclusion: 'success' }],
        }),
        { status: 200 }
      )
    );

    await expect(getPRWorkflowLogs('tok', 'owner/repo', '12345', { jobId: '42' })).rejects.toThrow(
      /No job with id 42/
    );
    expect(githubFetch).toHaveBeenCalledTimes(1);
  });

  it('throws when jobName matches no job in the run', async () => {
    githubFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jobs: [{ id: 1, name: 'lint', status: 'completed', conclusion: 'success' }],
        }),
        { status: 200 }
      )
    );

    await expect(
      getPRWorkflowLogs('tok', 'owner/repo', '12345', { jobName: 'rust-tests' })
    ).rejects.toThrow(/No job named rust-tests/);
    expect(githubFetch).toHaveBeenCalledTimes(1);
  });

  it('allJobs: true returns every job even when some failed', async () => {
    githubFetch.mockImplementation(async (url) => {
      if (url.includes('/actions/runs/12345/jobs')) {
        return new Response(
          JSON.stringify({
            jobs: [
              { id: 1, name: 'lint', status: 'completed', conclusion: 'failure' },
              { id: 2, name: 'test', status: 'completed', conclusion: 'success' },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/actions/jobs/1/logs')) {
        return new Response('', { status: 302, headers: { location: 'https://blob.example/1' } });
      }
      if (url.includes('/actions/jobs/2/logs')) {
        return new Response('', { status: 302, headers: { location: 'https://blob.example/2' } });
      }
      if (url === 'https://blob.example/1') {
        return new Response('lint log', { status: 200 });
      }
      if (url === 'https://blob.example/2') {
        return new Response('test log', { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflowLogs('tok', 'owner/repo', '12345', { allJobs: true });

    expect(result.jobs.map((j) => j.name)).toEqual(['lint', 'test']);
    expect(result.jobs.map((j) => j.log)).toEqual(['lint log', 'test log']);
  });
});
