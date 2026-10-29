import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { SUBAGENT_DEFAULT_PRESET } from '../../../shared/subagent-default-mode.js';
import { createStartSubagentTool } from '../mcp/tools/start-subagent.js';

function schemaRequiredKeys(user) {
  const tool = createStartSubagentTool({
    app: {},
    userId: 1,
    userParams: {},
    user,
  });
  const json = z.toJSONSchema(z.object(tool.schema));
  return json.required ?? [];
}

describe('createStartSubagentTool schema', () => {
  it('requires preset_model_id when subagent default is preset', () => {
    const required = schemaRequiredKeys({ subagent_default_mode: SUBAGENT_DEFAULT_PRESET });
    expect(required).toContain('preset_model_id');
  });

  it('exposes optional preset_model_id when subagent default is inherit', () => {
    const tool = createStartSubagentTool({
      app: {},
      userId: 1,
      userParams: {},
      user: { subagent_default_mode: 'inherit' },
    });
    expect(tool.schema.preset_model_id).toBeDefined();
    const json = z.toJSONSchema(z.object(tool.schema));
    expect(json.required ?? []).not.toContain('preset_model_id');
  });

  it('includes attach in schema', () => {
    const tool = createStartSubagentTool({
      app: {},
      userId: 1,
      userParams: {},
      user: { subagent_default_mode: 'inherit' },
    });
    expect(tool.schema.attach).toBeDefined();
  });

  it('exposes optional preset_model_id when subagent default is config', () => {
    const tool = createStartSubagentTool({
      app: {},
      userId: 1,
      userParams: {},
      user: { subagent_default_mode: 'config' },
    });
    expect(tool.schema.preset_model_id).toBeDefined();
    const json = z.toJSONSchema(z.object(tool.schema));
    expect(json.required ?? []).not.toContain('preset_model_id');
  });
});
