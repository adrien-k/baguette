export function createReadPlanTool(h) {
  return {
    name: 'ReadPlan',
    description:
      'Read the session plan markdown stored in the database. Use before EditPlan to copy old_string snippets exactly, or when you need the current plan text mid-turn.',
    schema: {},
    handler: h.readPlan,
  };
}
