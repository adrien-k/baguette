import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import logger from '../logger.js';
import { DATA_DIR, resolveDataDirRelativePath } from '../config.js';

const execFileAsync = promisify(execFile);

/**
 * Parse a GitHub plugin URL.
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch[/path/to/plugin]
 * Plain repo URLs (no /tree/branch) default to the "main" branch.
 * If the path is omitted, the plugin lives at the repo root (path ".").
 * Returns: { owner, repo, branch, pluginPath }
 */
export function parsePluginInput(input) {
  input = input.trim();

  // Try full URL with /tree/branch first
  const treeMatch = input.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.*))?$/
  );
  if (treeMatch) {
    let pluginPath = (treeMatch[4] ?? '').replace(/\/$/, '');
    if (!pluginPath) pluginPath = '.';
    return {
      owner: treeMatch[1],
      repo: treeMatch[2],
      branch: treeMatch[3],
      pluginPath,
    };
  }

  // Try plain repo URL: https://github.com/owner/repo
  const repoMatch = input.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/);
  if (repoMatch) {
    return {
      owner: repoMatch[1],
      repo: repoMatch[2],
      branch: 'main',
      pluginPath: '.',
    };
  }

  throw new Error(
    `Invalid plugin URL: "${input}". Expected https://github.com/owner/repo or …/tree/branch/path/to/plugin`
  );
}

/**
 * Get the remote HEAD sha for a branch without cloning.
 * Used to check whether a refresh is needed.
 */
export async function getRemoteSha(owner, repo, branch, token) {
  const repoUrl = buildRepoUrl(owner, repo, token);
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', repoUrl, `refs/heads/${branch}`], {
      timeout: 15000,
    });
    const sha = stdout.trim().split(/\s+/)[0];
    return sha || null;
  } catch {
    return null;
  }
}

function buildRepoUrl(owner, repo, token) {
  if (token) return `https://${token}@github.com/${owner}/${repo}.git`;
  return `https://github.com/${owner}/${repo}.git`;
}

/**
 * Clone the plugin directory via git sparse-checkout into a temp dir,
 * validate that .claude-plugin/plugin.json exists, then move to DATA_DIR.
 *
 * Returns: { localPath: string (relative to DATA_DIR), sha: string, pluginJson: object }
 * Throws if .claude-plugin/plugin.json is missing.
 */
export async function downloadPlugin(owner, repo, branch, pluginPath, token) {
  const tmpId = crypto.randomBytes(8).toString('hex');
  const tmpDir = path.join(os.tmpdir(), `baguette-plugin-${tmpId}`);

  try {
    const repoUrl = buildRepoUrl(owner, repo, token);

    // Sparse clone — only metadata, no blobs yet
    await execFileAsync(
      'git',
      [
        'clone',
        '--filter=blob:none',
        '--sparse',
        '--depth=1',
        `--branch=${branch}`,
        repoUrl,
        tmpDir,
      ],
      { timeout: 60000 }
    );

    // Check out only the plugin subdirectory
    if (pluginPath === '.') {
      // When the plugin lives at the repo root, disable sparse checkout
      // so all files (including .claude-plugin/) are materialized.
      // `sparse-checkout set --cone .` treats "." as a literal dir name
      // rather than the repo root, which leaves subdirectories missing.
      await execFileAsync('git', ['-C', tmpDir, 'sparse-checkout', 'disable'], { timeout: 30000 });
    } else {
      await execFileAsync('git', ['-C', tmpDir, 'sparse-checkout', 'set', '--cone', pluginPath], {
        timeout: 30000,
      });
    }

    const pluginDir = path.join(tmpDir, pluginPath);

    // Validate .claude-plugin/plugin.json
    const pluginJsonPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
    let pluginJson;
    try {
      const raw = await fs.readFile(pluginJsonPath, 'utf8');
      pluginJson = JSON.parse(raw);
    } catch {
      throw new Error(
        `Plugin is missing .claude-plugin/plugin.json. Make sure the URL points to a valid Claude Code plugin directory.`
      );
    }

    // Get sha
    const { stdout: shaOut } = await execFileAsync('git', ['-C', tmpDir, 'rev-parse', 'HEAD'], {
      timeout: 10000,
    });
    const sha = shaOut.trim();

    // Move plugin directory to its final location in DATA_DIR
    const localRelPath = path.join('plugins', owner, repo, pluginPath);
    const localAbsPath = path.join(DATA_DIR, localRelPath);
    await fs.mkdir(path.dirname(localAbsPath), { recursive: true });
    // Remove existing destination if present, then copy
    await fs.rm(localAbsPath, { recursive: true, force: true });
    await copyDir(pluginDir, localAbsPath);

    return { localPath: localRelPath, sha, pluginJson };
  } finally {
    // Always clean up temp dir
    await fs
      .rm(tmpDir, { recursive: true, force: true })
      .catch((err) =>
        logger.warn({ err, tmpDir }, 'Failed to clean up plugin temp dir (non-fatal)')
      );
  }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) => {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      return entry.isDirectory() ? copyDir(srcPath, destPath) : fs.copyFile(srcPath, destPath);
    })
  );
}

/**
 * Remove a plugin's local files.
 */
export async function removePluginFiles(localPath) {
  const absPath = resolveDataDirRelativePath(localPath);
  await fs.rm(absPath, { recursive: true, force: true }).catch((err) => {
    logger.warn({ err, absPath }, 'Failed to remove plugin files (non-fatal)');
  });
}
