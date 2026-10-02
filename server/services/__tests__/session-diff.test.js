import { describe, it, expect, vi } from 'vitest';
import {
  MAX_INLINE_DIFF_BYTES,
  isMaxBufferExceeded,
  isDiffWithinInlineLimit,
  pickDiffFilePath,
  resolveRequestedDiffFile,
  resolveSessionDiffResponse,
} from '../session-diff.js';

describe('session-diff', () => {
  it('isMaxBufferExceeded detects Node maxBuffer errors', () => {
    expect(isMaxBufferExceeded({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })).toBe(true);
    expect(isMaxBufferExceeded(new Error('other'))).toBe(false);
  });

  it('pickDiffFilePath prefers requested path when present', () => {
    const files = [
      { old_path: 'a.js', new_path: 'a.js' },
      { old_path: 'b.js', new_path: 'b.js' },
    ];
    expect(pickDiffFilePath(files, 'b.js')).toBe('b.js');
    expect(pickDiffFilePath(files, 'missing.js')).toBe('a.js');
    expect(pickDiffFilePath([], 'x')).toBe(null);
  });

  it('resolveSessionDiffResponse returns full diff when under limit', async () => {
    const result = await resolveSessionDiffResponse({
      getFullDiff: vi.fn().mockResolvedValue('small diff'),
      getFileList: vi.fn(),
      getFileDiff: vi.fn(),
      requestedFile: null,
    });
    expect(result).toEqual({ diff: 'small diff', file_by_file: false, file_path: null });
  });

  it('resolveSessionDiffResponse switches to first file when over limit', async () => {
    const err = new Error('maxBuffer');
    err.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    const getFileDiff = vi.fn().mockResolvedValue('one file diff');
    const result = await resolveSessionDiffResponse({
      getFullDiff: vi.fn().mockRejectedValue(err),
      getFileList: vi.fn().mockResolvedValue([
        { old_path: 'first.js', new_path: 'first.js' },
        { old_path: 'second.js', new_path: 'second.js' },
      ]),
      getFileDiff,
      requestedFile: null,
    });
    expect(result.file_by_file).toBe(true);
    expect(result.file_path).toBe('first.js');
    expect(result.diff).toBe('one file diff');
    expect(getFileDiff).toHaveBeenCalledWith('first.js');
  });

  it('resolveSessionDiffResponse skips full diff when file-by-file is already known', async () => {
    const getFullDiff = vi.fn();
    const getFileDiff = vi.fn().mockResolvedValue('picked file');
    const result = await resolveSessionDiffResponse({
      getFullDiff,
      getFileList: vi.fn().mockResolvedValue([{ old_path: 'src/foo.js', new_path: 'src/foo.js' }]),
      getFileDiff,
      requestedFile: 'src/foo.js',
      knownFileByFile: true,
    });
    expect(getFullDiff).not.toHaveBeenCalled();
    expect(result).toEqual({
      diff: 'picked file',
      file_by_file: true,
      file_path: 'src/foo.js',
    });
  });

  it('resolveSessionDiffResponse rejects unknown paths on file-by-file fast path', async () => {
    const getFileDiff = vi.fn();
    const result = await resolveSessionDiffResponse({
      getFullDiff: vi.fn(),
      getFileList: vi.fn().mockResolvedValue([{ old_path: 'a.js', new_path: 'a.js' }]),
      getFileDiff,
      requestedFile: '../../../etc/passwd',
      knownFileByFile: true,
    });
    expect(getFileDiff).not.toHaveBeenCalled();
    expect(result).toEqual({ diff: '', file_by_file: true, file_path: null });
  });

  it('resolveRequestedDiffFile does not fall back to the first path', () => {
    const files = [{ old_path: 'a.js', new_path: 'a.js' }];
    expect(resolveRequestedDiffFile(files, 'missing.js')).toBe(null);
    expect(resolveRequestedDiffFile(files, 'a.js')).toBe('a.js');
  });

  it('resolveSessionDiffResponse checks full diff before honoring a requested file', async () => {
    const getFullDiff = vi.fn().mockResolvedValue('small');
    const result = await resolveSessionDiffResponse({
      getFullDiff,
      getFileList: vi.fn(),
      getFileDiff: vi.fn(),
      requestedFile: 'src/foo.js',
      knownFileByFile: false,
    });
    expect(getFullDiff).toHaveBeenCalled();
    expect(result.file_by_file).toBe(false);
  });

  it('MAX_INLINE_DIFF_BYTES is exported for git maxBuffer', () => {
    expect(MAX_INLINE_DIFF_BYTES).toBeGreaterThan(0);
  });

  it('isDiffWithinInlineLimit uses UTF-8 byte length', () => {
    expect(isDiffWithinInlineLimit('')).toBe(true);
    expect(isDiffWithinInlineLimit('x'.repeat(MAX_INLINE_DIFF_BYTES))).toBe(true);
    expect(isDiffWithinInlineLimit('x'.repeat(MAX_INLINE_DIFF_BYTES + 1))).toBe(false);
  });

  it('resolveSessionDiffResponse switches to file-by-file when inline diff exceeds byte limit', async () => {
    const oversized = 'x'.repeat(MAX_INLINE_DIFF_BYTES + 1);
    const getFileDiff = vi.fn().mockResolvedValue('one file');
    const result = await resolveSessionDiffResponse({
      getFullDiff: vi.fn().mockResolvedValue(oversized),
      getFileList: vi.fn().mockResolvedValue([{ old_path: 'a.js', new_path: 'a.js' }]),
      getFileDiff,
      requestedFile: null,
    });
    expect(result.file_by_file).toBe(true);
    expect(result.file_path).toBe('a.js');
    expect(getFileDiff).toHaveBeenCalledWith('a.js');
  });
});
