// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createTestQueryClient, makeQueryClientWrapper } from '../../queries/testUtils.jsx';

const mockFind = vi.hoisted(() => vi.fn());

vi.mock('../../feathers.js', () => ({
  usageModelPricingService: {
    find: mockFind,
  },
}));

vi.mock('../Tooltip.jsx', () => ({
  default: ({ children, content }) => (
    <div data-testid="tooltip-wrapper">
      {children}
      <div data-testid="tooltip-content">{content}</div>
    </div>
  ),
}));

import UsageModelLabel from '../UsageModelLabel.jsx';

function renderLabel(props) {
  const queryClient = createTestQueryClient();
  const Wrapper = makeQueryClientWrapper(queryClient);
  return render(
    <Wrapper>
      <UsageModelLabel {...props} />
    </Wrapper>
  );
}

beforeEach(() => {
  mockFind.mockReset();
});

afterEach(cleanup);

describe('UsageModelLabel', () => {
  it('renders custom pricing tooltip for a model saved in usage_model_pricing', async () => {
    mockFind.mockResolvedValue({
      data: [
        {
          model_id: 'custom-model',
          source: 'custom',
          price_input: 1.25,
          price_cache_write: null,
          price_cache_read: 0.1,
          price_output: 5,
        },
      ],
      total: 1,
    });

    renderLabel({ model: 'custom-model' });

    await waitFor(() => {
      expect(screen.getByTestId('tooltip-content')).toBeTruthy();
    });
    const tooltip = screen.getByTestId('tooltip-content');
    expect(tooltip.textContent).toContain('USD per 1M tokens');
    expect(tooltip.textContent).toContain('$1.25');
    expect(tooltip.textContent).toContain('$0.1');
    expect(tooltip.textContent).toContain('$5');
  });

  it('prefers custom pricing over built-in pricing when overridden', async () => {
    mockFind.mockResolvedValue({
      data: [
        {
          model_id: 'claude-sonnet-5-5',
          source: 'custom',
          price_input: 99,
          price_cache_write: null,
          price_cache_read: null,
          price_output: 199,
        },
      ],
      total: 1,
    });

    renderLabel({ model: 'claude-sonnet-5-5' });

    await waitFor(() => {
      expect(screen.getByTestId('tooltip-content').textContent).toContain('$99');
    });
    expect(screen.getByTestId('tooltip-content').textContent).toContain('$199');
  });

  it('falls back to built-in pricing when no custom override exists', async () => {
    mockFind.mockResolvedValue({ data: [], total: 0 });

    renderLabel({ model: 'claude-sonnet-5-5' });

    await waitFor(() => {
      expect(mockFind).toHaveBeenCalled();
    });
    const tooltip = screen.getByTestId('tooltip-content');
    expect(tooltip.textContent).toContain('$2');
    expect(tooltip.textContent).toContain('$10');
  });

  it('renders plain label without pricing tooltip for missing model', async () => {
    mockFind.mockResolvedValue({
      data: [
        {
          model_id: 'unknown-model',
          source: 'missing',
          price_input: null,
          price_output: null,
        },
      ],
      total: 1,
    });

    renderLabel({ model: 'unknown-model' });

    await waitFor(() => {
      expect(mockFind).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('tooltip-content')).toBeNull();
    expect(screen.getByText('unknown-model').getAttribute('title')).toBe('unknown-model');
  });
});
