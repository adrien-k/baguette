import { describe, it, expect } from 'vitest';
import { issueAgentMetadataFromTurn } from '../session-issues.js';
import { registerSdkPlugin } from '../../agent-sdks/registry.js';

registerSdkPlugin({
  key: 'params-sdk',
  label: 'Params',
  servicePath: 'params-agent',
  supportsModelParams: true,
});

describe('issueAgentMetadataFromTurn', () => {
  it('keeps model_params when the plugin supports them', () => {
    expect(
      issueAgentMetadataFromTurn({
        agent_sdk: 'params-sdk',
        model: 'm',
        model_params: [{ id: 'fast', value: 'true' }],
      })
    ).toEqual({
      agent_sdk: 'params-sdk',
      model: 'm',
      model_params: [{ id: 'fast', value: 'true' }],
    });
  });

  it('drops model_params when the plugin does not support them', () => {
    expect(
      issueAgentMetadataFromTurn({
        agent_sdk: 'unknown-sdk',
        model: 'm',
        model_params: [{ id: 'fast', value: 'true' }],
      })
    ).toEqual({
      agent_sdk: 'unknown-sdk',
      model: 'm',
      model_params: null,
    });
  });
});
