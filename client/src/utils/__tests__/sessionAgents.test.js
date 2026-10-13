import { describe, it, expect } from 'vitest';
import {
  agentDisplayTitle,
  agentMenuOptionLabel,
  agentNameMatchesType,
  agentShowsTypeBadge,
} from '../sessionAgents.js';

describe('agent display labels', () => {
  it('treats default names as matching agent type', () => {
    expect(agentNameMatchesType('Builder', 'builder')).toBe(true);
    expect(agentNameMatchesType('builder', 'builder')).toBe(true);
    expect(agentNameMatchesType('Reviewer', 'reviewer')).toBe(true);
    expect(agentNameMatchesType('Code review bot', 'reviewer')).toBe(false);
  });

  it('shows only the type label when name matches type', () => {
    const agent = { name: 'Builder', agent_type: 'builder' };
    expect(agentDisplayTitle(agent)).toBe('Builder');
    expect(agentShowsTypeBadge(agent)).toBe(false);
    expect(agentMenuOptionLabel(agent)).toBe('Builder');
  });

  it('shows custom name and badge when name differs from type', () => {
    const agent = { name: 'Ship it', agent_type: 'builder' };
    expect(agentDisplayTitle(agent)).toBe('Ship it');
    expect(agentShowsTypeBadge(agent)).toBe(true);
    expect(agentMenuOptionLabel(agent)).toBe('Ship it (Builder)');
  });
});
