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
                completed_at: null,
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
      if (url.includes('/pulls?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url === 'https://api.github.com/graphql') {
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                object: {
                  oid: 'deadbeef',
                  statusCheckRollup: { contexts: { nodes: [] } },
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/commits/deadbeef/check-runs')) {
        return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
      }
      if (url.includes('/commits/deadbeef/status')) {
        return new Response(JSON.stringify({ statuses: [] }), { status: 200 });
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
      completed_at: '2026-01-01T00:10:00Z',
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
    expect(result.checks_source).toBe('rest');
    expect(result.head_sha).toBe('deadbeef');
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
                  headRefTarget: {
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
    expect(result.checks_source).toBe('graphql');
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

  it('falls back to REST check runs when GraphQL rollup is empty', async () => {
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/actions/runs?')) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 1,
                name: 'CI',
                status: 'completed',
                conclusion: 'failure',
                html_url: 'https://github.com/o/r/actions/runs/1',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:05:00Z',
                completed_at: '2026-01-01T00:05:00Z',
                path: 'ci.yml',
                event: 'pull_request',
                head_sha: 'sha1',
                run_attempt: 1,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/actions/runs/1/jobs')) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      }
      if (url.includes('/pulls?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url === 'https://api.github.com/graphql') {
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                object: {
                  oid: 'sha1',
                  statusCheckRollup: { contexts: { nodes: [] } },
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/commits/sha1/check-runs')) {
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                name: 'test',
                conclusion: 'failure',
                status: 'completed',
                html_url: 'https://github.com/o/r/runs/1',
                app: { name: 'GitHub Actions', slug: 'github-actions' },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/commits/sha1/status')) {
        return new Response(JSON.stringify({ statuses: [] }), { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat');
    expect(result.checks).toEqual([
      {
        name: 'test',
        conclusion: 'failure',
        status: 'completed',
        required: false,
        app: 'GitHub Actions',
        html_url: 'https://github.com/o/r/runs/1',
      },
    ]);
    expect(result.checks_source).toBe('rest');
  });

  it('resolves open PR by branch when prNumber is omitted', async () => {
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/pulls?head=')) {
        return new Response(
          JSON.stringify([
            {
              number: 12,
              html_url: 'https://github.com/o/r/pull/12',
              title: 't',
              base: { ref: 'main' },
              draft: false,
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('/actions/runs?')) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }
      if (url === 'https://api.github.com/graphql') {
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  headRefTarget: {
                    oid: 'from-pr',
                    statusCheckRollup: { contexts: { nodes: [] } },
                  },
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/commits/from-pr/check-runs')) {
        return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
      }
      if (url.includes('/commits/from-pr/status')) {
        return new Response(JSON.stringify({ statuses: [] }), { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat');
    expect(result.resolved_pr_number).toBe(12);
    expect(result.head_sha).toBe('from-pr');
    expect(result.checks_source).toBe('rest');
  });

  it('filters runs by conclusion', async () => {
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/actions/runs?')) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 1,
                name: 'ok',
                status: 'completed',
                conclusion: 'success',
                html_url: 'u',
                created_at: 't',
                updated_at: 't',
                completed_at: 't',
                path: 'p',
                event: 'push',
                head_sha: 'a',
                run_attempt: 1,
              },
              {
                id: 2,
                name: 'bad',
                status: 'completed',
                conclusion: 'failure',
                html_url: 'u',
                created_at: 't',
                updated_at: 't',
                completed_at: 't',
                path: 'p',
                event: 'push',
                head_sha: 'a',
                run_attempt: 1,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/actions/runs/1/jobs') || url.includes('/actions/runs/2/jobs')) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      }
      if (url.includes('/pulls?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/commits/')) {
        return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
      }
      if (url.includes('/status')) {
        return new Response(JSON.stringify({ statuses: [] }), { status: 200 });
      }
      if (url === 'https://api.github.com/graphql') {
        return new Response(
          JSON.stringify({
            data: {
              repository: { object: { oid: 'a', statusCheckRollup: { contexts: { nodes: [] } } } },
            },
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat', { conclusion: 'failure' });
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].id).toBe(2);
  });

  function workflowRun(id, status, conclusion, headSha = 'a') {
    return {
      id,
      name: 'CI',
      status,
      conclusion: status === 'completed' ? conclusion : null,
      html_url: `https://github.com/o/r/actions/runs/${id}`,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:05:00Z',
      completed_at: status === 'completed' ? '2026-01-01T00:05:00Z' : null,
      path: 'ci.yml',
      event: 'push',
      head_sha: headSha,
      run_attempt: 1,
    };
  }

  function emptyRollupStubs(url) {
    if (url === 'https://api.github.com/graphql') {
      return new Response(
        JSON.stringify({
          data: {
            repository: { object: { oid: 'a', statusCheckRollup: { contexts: { nodes: [] } } } },
          },
        }),
        { status: 200 }
      );
    }
    if (url.includes('/commits/a/check-runs')) {
      return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
    }
    if (url.includes('/commits/a/status')) {
      return new Response(JSON.stringify({ statuses: [] }), { status: 200 });
    }
    return null;
  }

  it('wait_for_run_id polls the run by id and resolves when it completes', async () => {
    let runFetches = 0;
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/pulls?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/actions/runs?')) {
        return new Response(
          JSON.stringify({ workflow_runs: [workflowRun(55, 'completed', 'success')] }),
          { status: 200 }
        );
      }
      if (url.includes('/actions/runs/55/jobs')) {
        return new Response(
          JSON.stringify({
            jobs: [
              { id: 1, name: 'test', status: 'completed', conclusion: 'success', html_url: 'u' },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/actions/runs/55')) {
        runFetches += 1;
        const status = runFetches === 1 ? 'in_progress' : 'completed';
        return new Response(
          JSON.stringify({ id: 55, status, conclusion: status === 'completed' ? 'success' : null }),
          { status: 200 }
        );
      }
      const stub = emptyRollupStubs(url);
      if (stub) return stub;
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat', {
      waitForRunId: '55',
      pollIntervalMs: 1,
    });
    expect(runFetches).toBe(2);
    expect(result.runs[0].id).toBe(55);
    expect(result.runs[0].jobs).toHaveLength(1);
    expect(result.wait_timed_out).toBeUndefined();
    expect(result.wait_fetch_failed).toBeUndefined();
    expect(result.wait_run_not_found).toBeUndefined();
  });

  it('wait_for_run_id keeps waiting through run-fetch failures and surfaces stop flags', async () => {
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/pulls?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/actions/runs?')) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }
      if (url.endsWith('/actions/runs/77')) {
        return new Response('boom', { status: 500 });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat', {
      waitForRunId: '77',
      pollIntervalMs: 1,
      waitTimeoutSeconds: 0.05,
    });
    expect(result.wait_timed_out).toBe(true);
    expect(result.wait_fetch_failed).toBe(true);
    expect(result.wait_run_not_found).toBe(true);
    expect(result.runs).toEqual([]);
  });

  it('wait_for_run_id fetches the target run directly when it slid out of the branch page', async () => {
    let runFetches = 0;
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/pulls?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/actions/runs?')) {
        return new Response(
          JSON.stringify({ workflow_runs: [workflowRun(99, 'completed', 'success', 'b')] }),
          { status: 200 }
        );
      }
      if (url.includes('/actions/runs/55/jobs')) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 5,
                name: 'rust-tests',
                status: 'completed',
                conclusion: 'failure',
                html_url: 'u',
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/actions/runs/99/jobs')) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      }
      if (url.endsWith('/actions/runs/55')) {
        runFetches += 1;
        const status = runFetches < 3 ? 'in_progress' : 'completed';
        return new Response(
          JSON.stringify({ id: 55, status, conclusion: status === 'completed' ? 'failure' : null }),
          { status: 200 }
        );
      }
      const stub = emptyRollupStubs(url);
      if (stub) return stub;
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat', {
      waitForRunId: '55',
      pollIntervalMs: 1,
    });
    // 2 in-progress polls + 1 completed poll + 1 final full fetch (with jobs)
    expect(runFetches).toBe(4);
    expect(result.runs[0].id).toBe(55);
    expect(result.runs[0].jobs).toHaveLength(1);
    expect(result.runs[1].id).toBe(99);
    expect(result.wait_timed_out).toBeUndefined();
    expect(result.wait_run_not_found).toBeUndefined();
  });

  it('wait_for_completion keeps polling through a failed page fetch and recovers', async () => {
    let pageFetches = 0;
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/pulls?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/actions/runs?')) {
        pageFetches += 1;
        if (pageFetches === 1) return new Response('boom', { status: 500 });
        const status = pageFetches === 2 ? 'in_progress' : 'completed';
        return new Response(
          JSON.stringify({ workflow_runs: [workflowRun(1, status, 'success')] }),
          { status: 200 }
        );
      }
      if (url.includes('/actions/runs/1/jobs')) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      }
      const stub = emptyRollupStubs(url);
      if (stub) return stub;
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat', {
      waitForCompletion: true,
      pollIntervalMs: 1,
    });
    expect(pageFetches).toBe(3);
    expect(result.runs[0].status).toBe('completed');
    expect(result.wait_timed_out).toBeUndefined();
    expect(result.wait_fetch_failed).toBeUndefined();
  });

  it('wait_for_completion surfaces wait_timed_out and wait_fetch_failed when page fetches keep failing', async () => {
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/pulls?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/actions/runs?')) {
        return new Response('boom', { status: 500 });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat', {
      waitForCompletion: true,
      pollIntervalMs: 1,
      waitTimeoutSeconds: 0.05,
    });
    expect(result.wait_timed_out).toBe(true);
    expect(result.wait_fetch_failed).toBe(true);
    expect(result.runs).toEqual([]);
  });

  it('wait_for_completion polls until runs settle and returns the settled page', async () => {
    let pageFetches = 0;
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/pulls?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/actions/runs?')) {
        pageFetches += 1;
        const status = pageFetches === 1 ? 'in_progress' : 'completed';
        return new Response(
          JSON.stringify({ workflow_runs: [workflowRun(1, status, 'success')] }),
          { status: 200 }
        );
      }
      if (url.includes('/actions/runs/1/jobs')) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      }
      const stub = emptyRollupStubs(url);
      if (stub) return stub;
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat', {
      waitForCompletion: true,
      pollIntervalMs: 1,
    });
    expect(pageFetches).toBe(2);
    expect(result.runs[0].status).toBe('completed');
    expect(result.wait_timed_out).toBeUndefined();
  });

  it('wait_for_completion times out while runs stay in flight and keeps the in-flight runs', async () => {
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/pulls?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/actions/runs?')) {
        return new Response(
          JSON.stringify({ workflow_runs: [workflowRun(1, 'in_progress', null)] }),
          { status: 200 }
        );
      }
      if (url.includes('/actions/runs/1/jobs')) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      }
      const stub = emptyRollupStubs(url);
      if (stub) return stub;
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat', {
      waitForCompletion: true,
      pollIntervalMs: 1,
      waitTimeoutSeconds: 0.05,
    });
    expect(result.wait_timed_out).toBe(true);
    expect(result.wait_fetch_failed).toBeUndefined();
    expect(result.runs[0].status).toBe('in_progress');
  });

  it('filters runs by status', async () => {
    vi.mocked(githubFetch).mockImplementation(async (url) => {
      if (url.includes('/actions/runs?')) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              workflowRun(1, 'completed', 'success'),
              workflowRun(2, 'in_progress', null),
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/actions/runs/1/jobs') || url.includes('/actions/runs/2/jobs')) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      }
      if (url.includes('/pulls?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      const stub = emptyRollupStubs(url);
      if (stub) return stub;
      throw new Error(`unexpected url ${url}`);
    });

    const result = await getPRWorkflows('token', 'o/r', 'feat', { status: 'completed' });
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].id).toBe(1);
  });
});
