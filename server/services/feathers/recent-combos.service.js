import { NotFound } from '@feathersjs/errors';
import { requireUser } from './hooks.js';

class RecentCombosService {
  setup(app) {
    this.app = app;
  }

  async find(params) {
    const db = this.app.get('db');
    const userId = params?.user?.id;
    const repoFullName = params?.query?.repoFullName;

    const repo = repoFullName ? await db('repos').where({ full_name: repoFullName }).first() : null;
    if (repoFullName && !repo) return [];

    const q = db('recent_combos')
      .where({ user_id: userId })
      .orderBy('updated_at', 'desc')
      .limit(5)
      .select('id', 'agent_sdk', 'model', 'params', 'variant_id');
    if (repo) q.where({ repo_id: repo.id });

    const rows = await q;
    return rows.map((r) => ({
      id: r.id,
      agentSdk: r.agent_sdk,
      model: r.model,
      params: r.params ?? null,
      variantId: r.variant_id ?? null,
    }));
  }

  async remove(id, params) {
    const db = this.app.get('db');
    const userId = params?.user?.id;
    const combo = await db('recent_combos').where({ id, user_id: userId }).first();
    if (!combo) throw new NotFound('Combo not found');
    await db('recent_combos').where({ id }).delete();
    return { id };
  }
}

export function registerRecentCombosService(app) {
  app.use('recent-combos', new RecentCombosService(), {
    methods: ['find', 'remove'],
  });
  app.service('recent-combos').hooks({
    before: {
      all: [requireUser],
    },
  });
}
