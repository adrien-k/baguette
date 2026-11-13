import { describe, it, expect, vi, afterEach } from 'vitest';
import { prBasePatchField, upsertPR } from '../github.js';

vi.mock('../github-api.js', () => ({
  githubFetch: vi.fn(),
}));

import { githubFetch } from '../github-api.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('prBasePatchField', () => {
  it('returns the new base only when it differs from the current PR base', () => {
    expect(prBasePatchField('develop', 'main')).toBe('develop');
  });

  it('omits base when the PR is already on that branch', () => {
    expect(prBasePatchField('main', 'main')).toBeUndefined();
  });

  it('omits base when the current PR base is unknown', () => {
    expect(prBasePatchField('main', undefined)).toBeUndefined();
  });
});

describe('upsertPR', () => {
  afterEach(() => {
    vi.mocked(githubFetch).mockReset();
  });

  it('includes base when retargeting an existing pull request', async () => {
    vi.mocked(githubFetch).mockResolvedValue(
      jsonResponse({ html_url: 'https://github.com/o/r/pull/5', number: 5 })
    );

    await upsertPR('token', {
      repoFullName: 'o/r',
      prNumber: 5,
      title: 'Title',
      body: 'Body',
      baseBranch: 'develop',
      currentBaseBranch: 'main',
    });

    expect(githubFetch).toHaveBeenCalledOnce();
    const [, init] = githubFetch.mock.calls[0];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      title: 'Title',
      body: 'Body',
      base: 'develop',
    });
  });

  it('omits base when the existing pull request already uses that branch', async () => {
    vi.mocked(githubFetch).mockResolvedValue(
      jsonResponse({ html_url: 'https://github.com/o/r/pull/5', number: 5 })
    );

    await upsertPR('token', {
      repoFullName: 'o/r',
      prNumber: 5,
      title: 'Title',
      body: 'Body',
      baseBranch: 'main',
      currentBaseBranch: 'main',
    });

    const [, init] = githubFetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ title: 'Title', body: 'Body' });
  });

  it('omits base when the current PR base is not known', async () => {
    vi.mocked(githubFetch).mockResolvedValue(
      jsonResponse({ html_url: 'https://github.com/o/r/pull/5', number: 5 })
    );

    await upsertPR('token', {
      repoFullName: 'o/r',
      prNumber: 5,
      title: 'Title',
      body: 'Body',
      baseBranch: 'main',
    });

    const [, init] = githubFetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ title: 'Title', body: 'Body' });
  });

  it('omits base when baseBranch is not set on update', async () => {
    vi.mocked(githubFetch).mockResolvedValue(
      jsonResponse({ html_url: 'https://github.com/o/r/pull/5', number: 5 })
    );

    await upsertPR('token', {
      repoFullName: 'o/r',
      prNumber: 5,
      title: 'Title',
      body: 'Body',
    });

    const [, init] = githubFetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ title: 'Title', body: 'Body' });
  });
});
