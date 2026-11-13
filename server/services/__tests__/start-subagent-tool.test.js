import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  SUBAGENT_DEFAULT_ANY,
  SUBAGENT_DEFAULT_PRESET,
} from '../../../shared/subagent-default-mode.js';
import { createStartSubagentTool } from '../mcp/tools/start-subagent.js';
import { createListModelsTool } from '../mcp/tools/list-models.js';

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

  it('includes attach and notify_parent in schema', () => {
    const tool = createStartSubagentTool({
      app: {},
      userId: 1,
      userParams: {},
      user: { subagent_default_mode: 'inherit' },
    });
    expect(tool.schema.attach).toBeDefined();
    expect(tool.schema.notify_parent).toBeDefined();
  });

  it('exposes preset or raw model fields when the policy is any', () => {
    const tool = createStartSubagentTool({
      app: {},
      userId: 1,
      userParams: {},
      user: { subagent_default_mode: SUBAGENT_DEFAULT_ANY },
    });
    expect(tool.schema.preset_model_id).toBeDefined();
    expect(tool.schema.agent_config_id).toBeDefined();
    expect(tool.schema.model).toBeDefined();
    expect(tool.schema.model_params).toBeDefined();
    const json = z.toJSONSchema(z.object(tool.schema));
    expect(json.required ?? []).not.toContain('preset_model_id');
    expect(json.required ?? []).not.toContain('model');
    expect(tool.description).toMatch(/Any preset or model/);
  });

  it('hides raw model fields unless the policy is any', () => {
    const tool = createStartSubagentTool({
      app: {},
      userId: 1,
      userParams: {},
      user: { subagent_default_mode: 'inherit' },
    });
    expect(tool.schema.agent_config_id).toBeUndefined();
    expect(tool.schema.model).toBeUndefined();
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

describe('createListModelsTool schema', () => {
  it('requires agent_config_id unless the policy is any', () => {
    const restricted = createListModelsTool({
      app: {},
      userId: 1,
      user: { subagent_default_mode: 'inherit' },
    });
    const open = createListModelsTool({
      app: {},
      userId: 1,
      user: { subagent_default_mode: SUBAGENT_DEFAULT_ANY },
    });
    const restrictedJson = z.toJSONSchema(z.object(restricted.schema));
    const openJson = z.toJSONSchema(z.object(open.schema));
    expect(restrictedJson.required ?? []).toContain('agent_config_id');
    expect(openJson.required ?? []).not.toContain('agent_config_id');
  });
});
