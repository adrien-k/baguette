import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPRComments } from '../github.js';

vi.mock('../github-api.js', () => ({
  githubFetch: vi.fn(),
}));

import { githubFetch } from '../github-api.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('getPRComments', () => {
  afterEach(() => {
    vi.mocked(githubFetch).mockReset();
  });

  it('returns issue thread comments and review summaries in issueComments', async () => {
    vi.mocked(githubFetch).mockImplementation((url) => {
      if (url.includes('/issues/42/comments')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 1,
              user: { login: 'alice' },
              body: 'Please fix tests',
              created_at: '2026-01-02T00:00:00Z',
              html_url: 'https://github.com/o/r/issues/42#issuecomment-1',
            },
          ])
        );
      }
      if (url.includes('/pulls/42/reviews')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 99,
              user: { login: 'bob' },
              body: 'LGTM with nits',
              state: 'COMMENTED',
              submitted_at: '2026-01-03T00:00:00Z',
              html_url: 'https://github.com/o/r/pull/42#review-99',
            },
            { id: 100, user: { login: 'bob' }, body: '', state: 'COMMENTED', submitted_at: null },
          ])
        );
      }
      if (url.includes('/pulls/42/comments')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 2,
              user: { login: 'carol' },
              body: 'nit here',
              path: 'src/a.js',
              line: 4,
              created_at: '2026-01-04T00:00:00Z',
              html_url: 'https://github.com/o/r/pull/42#discussion_r2',
            },
          ])
        );
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    });

    const result = await getPRComments('token', 'o/r', 42);
    expect(result.warnings).toBeUndefined();
    expect(result.issueComments).toHaveLength(2);
    expect(result.issueComments[0]).toMatchObject({ id: 1, commentType: 'issue' });
    expect(result.issueComments[1]).toMatchObject({ id: 99, commentType: 'review_body' });
    expect(result.reviewComments).toHaveLength(1);
    expect(result.reviewComments[0]).toMatchObject({
      id: 2,
      commentType: 'review',
      path: 'src/a.js',
    });
  });

  it('omits comments marked viewed with an eyes reaction', async () => {
    vi.mocked(githubFetch).mockImplementation((url) => {
      if (url.includes('/issues/')) {
        return Promise.resolve(
          jsonResponse([
            { id: 1, body: 'seen', reactions: { eyes: 1 }, created_at: '2026-01-01T00:00:00Z' },
            { id: 2, body: 'new', created_at: '2026-01-02T00:00:00Z' },
          ])
        );
      }
      return Promise.resolve(jsonResponse([]));
    });

    const result = await getPRComments('token', 'o/r', 42);
    expect(result.issueComments.map((c) => c.id)).toEqual([2]);
  });

  it('surfaces a warning when the issues API fails but still returns review bodies', async () => {
    vi.mocked(githubFetch).mockImplementation((url) => {
      if (url.includes('/issues/42/comments')) {
        return Promise.resolve(new Response('Forbidden', { status: 403 }));
      }
      if (url.includes('/pulls/42/reviews')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 50,
              user: { login: 'rev' },
              body: 'Summary only',
              state: 'COMMENTED',
              submitted_at: '2026-01-05T00:00:00Z',
              html_url: 'https://github.com/o/r/pull/42#review-50',
            },
          ])
        );
      }
      return Promise.resolve(jsonResponse([]));
    });

    const result = await getPRComments('token', 'o/r', 42);
    expect(result.warnings?.length).toBeGreaterThan(0);
    expect(result.issueComments).toHaveLength(1);
    expect(result.issueComments[0]).toMatchObject({ commentType: 'review_body', id: 50 });
  });
});
