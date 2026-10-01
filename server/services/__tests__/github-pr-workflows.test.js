import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPRWorkflows } from '../github.js';

vi.mock('../github-api.js', () => ({
  githubFetch: vi.fn(),
}));

import { githubFetch } from '../github-api.js';

describe('getPRWorkflows', () => {
  beforeEach(() => {
    vi.mocked(githubFetch).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps workflow runs with jobs and metadata', async () => {
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/actions/runs?')) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 99,
                name: 'Build and Test',
                status: 'completed',
                conclusion: 'success',
                html_url: 'https://github.com/o/r/actions/runs/99',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:10:00Z',
                completed_at: '2026-01-01T00:10:00Z',
                path: '.github/workflows/ci.yml',
                event: 'pull_request',
                head_sha: 'deadbeef',
                run_attempt: 2,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/actions/runs/99/jobs')) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 1,
                name: 'rspec',
                status: 'completed',
                conclusion: 'success',
                html_url: 'https://github.com/o/r/actions/runs/99/job/1',
              },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat');
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      id: 99,
      path: '.github/workflows/ci.yml',
      event: 'pull_request',
      head_sha: 'deadbeef',
      run_attempt: 2,
      jobs: [
        {
          id: 1,
          name: 'rspec',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/o/r/actions/runs/99/job/1',
        },
      ],
    });
    expect(result.checks).toEqual([]);
    expect(result.head_sha).toBeNull();
  });

  it('fetches PR check rollup when prNumber is set', async () => {
    vi.mocked(githubFetch).mockImplementation(async (url, init) => {
      if (url.includes('/actions/runs?')) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }
      if (url === 'https://api.github.com/graphql') {
        const body = JSON.parse(init.body);
        expect(body.variables).toEqual({ owner: 'o', repo: 'r', number: 7 });
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  commits: {
                    nodes: [
                      {
                        commit: {
                          oid: 'abc123',
                          statusCheckRollup: {
                            contexts: {
                              nodes: [
                                {
                                  __typename: 'CheckRun',
                                  name: 'Greptile',
                                  conclusion: 'SUCCESS',
                                  status: 'COMPLETED',
                                  isRequired: false,
                                  detailsUrl: 'https://greptile.example/check',
                                  checkSuite: { app: { name: 'Greptile', slug: 'greptile' } },
                                },
                                {
                                  __typename: 'StatusContext',
                                  context: 'legacy-ci',
                                  state: 'SUCCESS',
                                  isRequired: true,
                                  targetUrl: 'https://example.com/legacy',
                                },
                              ],
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat', { prNumber: 7 });
    expect(result.head_sha).toBe('abc123');
    expect(result.checks).toEqual([
      {
        name: 'Greptile',
        conclusion: 'success',
        status: 'completed',
        required: false,
        app: 'Greptile',
        html_url: 'https://greptile.example/check',
      },
      {
        name: 'legacy-ci',
        conclusion: 'success',
        status: null,
        required: true,
        app: null,
        html_url: 'https://example.com/legacy',
      },
    ]);
  });
});
