import {
  loadBaguetteConfig,
  getAvailableCommands,
  BaguetteConfigError,
} from '../../baguette-config.js';
import { ok, fail } from '../lib/result.js';

export function createListProjectCommandsTool(ctx) {
  const { session } = ctx;
  return {
    name: 'ListProjectCommands',
    description:
      'List available project commands defined in .baguette.yaml (tests, linters, migrations, etc.). Each command may include `depends_on` (task keys from `depends-on` in the config). RunTask starts and awaits those dependencies automatically — do not start them separately.',
    schema: {},
    handler: async () => {
      let cfg;
      try {
        cfg = await loadBaguetteConfig(session.session_path);
        if (cfg?.error) throw new Error(cfg.error);
      } catch (err) {
        return fail(err.message);
      }
      if (!cfg) {
        return ok({
          commands: [],
          message:
            'No Baguette config found (.baguette.yaml). Run ConfigRepoPrompt and follow the instructions.',
        });
      }
      let commands;
      try {
        commands = getAvailableCommands(cfg).filter(
          (c) =>
            c && typeof c.label === 'string' && (typeof c.run === 'string' || c.type === 'docker')
        );
      } catch (err) {
        if (err instanceof BaguetteConfigError) return fail(err.message);
        throw err;
      }
      return ok({ commands });
    },
  };
}
