import { describe, it, expect } from 'vitest';
import { parseGitLogSinceBaseOutput } from '../github.js';

const FS = '\x1e';
const RS = '\x1d';

function formatCommit({ sha, short_sha, subject, author_name, author_email, author_date }) {
  return `${sha}${FS}${short_sha}${FS}${subject}${FS}${author_name}${FS}${author_email}${FS}${author_date}${RS}`;
}

describe('parseGitLogSinceBaseOutput', () => {
  it('returns empty array for blank output', () => {
    expect(parseGitLogSinceBaseOutput('')).toEqual([]);
    expect(parseGitLogSinceBaseOutput('   \n  ')).toEqual([]);
  });

  it('drops trailing record separator artefact (single commit)', () => {
    const stdout = formatCommit({
      sha: '46145c0525d826de344f3bcf7b818d4519420629',
      short_sha: '46145c0',
      subject: 'Add DBA joke to README',
      author_name: 'dev',
      author_email: 'dev@example.com',
      author_date: '2026-09-27T21:28:49+00:00',
    });
    const commits = parseGitLogSinceBaseOutput(stdout);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      sha: '46145c0525d826de344f3bcf7b818d4519420629',
      short_sha: '46145c0',
      subject: 'Add DBA joke to README',
      author_name: 'dev',
      author_email: 'dev@example.com',
      author_date: '2026-09-27T21:28:49+00:00',
    });
  });

  it('parses multiple commits without blank entries', () => {
    const stdout =
      formatCommit({
        sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        short_sha: 'bbbbbbb',
        subject: 'Second',
        author_name: 'dev',
        author_email: 'dev@example.com',
        author_date: '2026-09-28T10:00:00+00:00',
      }) +
      formatCommit({
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        short_sha: 'aaaaaaa',
        subject: 'First',
        author_name: 'dev',
        author_email: 'dev@example.com',
        author_date: '2026-09-27T21:28:49+00:00',
      });
    const commits = parseGitLogSinceBaseOutput(stdout);
    expect(commits).toHaveLength(2);
    expect(commits.every((c) => c.sha && c.short_sha && c.subject)).toBe(true);
  });

  it('skips records with missing sha', () => {
    const stdout = `${RS}aaa${FS}aaa${FS}ok${FS}x${FS}x@y.z${FS}2026-01-01T00:00:00+00:00${RS}`;
    const commits = parseGitLogSinceBaseOutput(stdout);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('aaa');
  });
});
