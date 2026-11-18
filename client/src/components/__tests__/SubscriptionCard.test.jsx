// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const limits = vi.hoisted(() => ({ value: {} }));

vi.mock('../../hooks/useSubscriptionLimits.js', () => ({
  useSubscriptionLimits: () => limits.value,
}));
vi.mock('../../feathers.js', () => ({ sessionsService: { patch: vi.fn() } }));
vi.mock('../AgentConfigLogo.jsx', () => ({ default: () => null }));

import SubscriptionCard from '../SubscriptionCard.jsx';

const claudeProvider = {
  sdk: 'claude',
  label: 'Claude',
  status: 'ok',
  limits: [{ id: 'session', label: 'Session (5h)', percent: 10 }],
};

function renderCard(state) {
  limits.value = {
    providers: [],
    loading: false,
    error: null,
    syncing: false,
    sync: vi.fn(),
    ...state,
  };
  return render(<SubscriptionCard session={{ id: 1, agent_sdk: 'x' }} locked={false} />);
}

afterEach(cleanup);

describe('SubscriptionCard', () => {
  it('renders nothing for an SDK with no plan limits (e.g. Pi)', () => {
    const { container } = renderCard({ providers: [] });
    expect(container.firstChild).toBeNull();
  });

  it('shows the card while loading and when a provider reports limits', () => {
    renderCard({ loading: true });
    expect(screen.getByText('Usage limits')).toBeTruthy();
    cleanup();
    renderCard({ providers: [claudeProvider] });
    expect(screen.getByText('Session (5h)')).toBeTruthy();
  });

  it('keeps the card on a load error so the failure is visible', () => {
    renderCard({ error: new Error('boom') });
    expect(screen.getByText(/boom/)).toBeTruthy();
  });
});
