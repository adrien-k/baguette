import path from 'path';
import { KnexService } from '@feathersjs/knex';
import { BadRequest, NotFound } from '@feathersjs/errors';
import {
  parsePluginInput,
  getRemoteSha,
  downloadPlugin,
  removePluginFiles,
} from '../plugins-service.js';
import { getEffectiveGithubToken } from '../agent-settings.js';
import { requireUser } from './hooks.js';

class PluginsService extends KnexService {
  async find(_params) {
    return this.options
      .Model('plugins')
      .select()
      .orderBy([
        { column: 'marketplace_repo', order: 'asc' },
        { column: 'plugin_path', order: 'asc' },
      ]);
  }

  async create(data, params) {
    const { input } = data;
    if (!input || typeof input !== 'string') throw new BadRequest('input is required');

    const { owner, repo, branch, pluginPath } = parsePluginInput(input.trim());
    const db = this.options.Model;
    const marketplaceRepo = `${owner}/${repo}`;
    const token = getEffectiveGithubToken(params.user) || undefined;

    const existing = await db('plugins')
      .where({ marketplace_repo: marketplaceRepo, plugin_path: pluginPath })
      .first();
    const remoteSha = await getRemoteSha(owner, repo, branch, token);

    if (existing && existing.git_sha && remoteSha && existing.git_sha === remoteSha) {
      return { installed: [], skipped: [existing] };
    }

    const { localPath, sha, pluginJson } = await downloadPlugin(
      owner,
      repo,
      branch,
      pluginPath,
      token
    );
    const name = pluginJson.name || path.basename(pluginPath);
    const description = pluginJson.description || null;
    const now = new Date().toISOString();

    if (existing) {
      const updates = { name, description, git_sha: sha, local_path: localPath, updated_at: now };
      await db('plugins').where({ id: existing.id }).update(updates);
      return { installed: [{ ...existing, ...updates }], skipped: [] };
    } else {
      const row = {
        name,
        marketplace_repo: marketplaceRepo,
        plugin_path: pluginPath,
        local_path: localPath,
        git_sha: sha,
        description,
        created_at: now,
        updated_at: now,
      };
      const [id] = await db('plugins').insert(row);
      return { installed: [{ id, ...row }], skipped: [] };
    }
  }

  async remove(id, _params) {
    const db = this.options.Model;
    const plugin = await db('plugins').where({ id }).first();
    if (!plugin) throw new NotFound('Plugin not found');
    await removePluginFiles(plugin.local_path);
    await db('plugins').where({ id }).delete();
    return { ok: true };
  }

  async refresh(data, params) {
    const { id } = data;
    const db = this.options.Model;
    const plugin = await db('plugins').where({ id }).first();
    if (!plugin) throw new NotFound('Plugin not found');

    const token = getEffectiveGithubToken(params.user) || undefined;
    const [owner, repo] = plugin.marketplace_repo.split('/');

    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'User-Agent': 'baguette-app',
        Accept: 'application/vnd.github.v3+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const repoData = ghRes.ok ? await ghRes.json() : {};
    const branch = repoData.default_branch || 'main';

    const remoteSha = await getRemoteSha(owner, repo, branch, token);
    if (plugin.git_sha && remoteSha && plugin.git_sha === remoteSha) {
      return { refreshed: false, plugin };
    }

    const { localPath, sha, pluginJson } = await downloadPlugin(
      owner,
      repo,
      branch,
      plugin.plugin_path,
      token
    );
    const name = pluginJson.name || path.basename(plugin.plugin_path);
    const description = pluginJson.description || null;
    const now = new Date().toISOString();
    const updates = { name, description, git_sha: sha, local_path: localPath, updated_at: now };
    await db('plugins').where({ id }).update(updates);
    return { refreshed: true, plugin: { ...plugin, ...updates } };
  }
}

const pluginsHooks = {
  before: {
    all: [requireUser],
  },
};

export function registerPluginsService(app, path = 'admin/plugins') {
  app.use(path, new PluginsService({ Model: app.get('db'), name: 'plugins', id: 'id' }), {
    methods: ['find', 'create', 'remove', 'refresh'],
  });
  app.service(path).hooks(pluginsHooks);
}
