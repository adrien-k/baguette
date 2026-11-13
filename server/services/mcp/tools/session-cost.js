import { ok, fail } from '../lib/result.js';

const money = (usd) => `$${usd.toFixed(usd < 1 ? 4 : 2)}`;

export function createSessionCostTool(ctx) {
  const { app } = ctx;
  return {
    name: 'SessionCost',
    description:
      'How much this session has cost so far — total in USD and tokens, and a breakdown per ' +
      'agent and model. Use it when asked about cost, spend or tokens.',
    schema: {},
    handler: async () => {
      const session = ctx.session;
      if (!session?.id) return fail('No session.');
      const { totals, breakdown } = await app
        .service('sessions')
        .sessionUsage(session.id, { user: { id: session.user_id } });
      return ok({
        total_cost_usd: totals.cost_usd,
        total_cost: money(totals.cost_usd),
        input_tokens: totals.input_tokens,
        output_tokens: totals.output_tokens,
        total_tokens: totals.total_tokens,
        breakdown: breakdown.map((row) => ({ ...row, cost: money(row.cost_usd) })),
      });
    },
  };
}
