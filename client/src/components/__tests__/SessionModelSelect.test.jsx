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

vi.mock('../../hooks/useSdkMetas.js', () => ({
  useSdkMetas: () => ({
    getMeta: (key) =>
      key === 'cursor'
        ? { key: 'cursor', label: 'Cursor', usesAgentPricingTable: true }
        : { key, label: key, usesAgentPricingTable: false },
  }),
}));

vi.mock('../../hooks/useMediaQuery.js', () => ({
  useMediaQuery: () => true,
}));

vi.mock('../AgentConfigLogo.jsx', () => ({ default: () => null }));

import SessionModelSelect from '../SessionModelSelect.jsx';

function renderSelect(props = {}) {
  const queryClient = createTestQueryClient();
  const Wrapper = makeQueryClientWrapper(queryClient);
  return render(
    <Wrapper>
      <SessionModelSelect
        agentConfigKey="cursor"
        model="custom-unknown-model"
        params={null}
        models={[{ id: 'custom-unknown-model', display_name: 'Custom Unknown' }]}
        onModelChange={vi.fn()}
        {...props}
      />
    </Wrapper>
  );
}

beforeEach(() => {
  mockFind.mockReset();
});

afterEach(cleanup);

describe('SessionModelSelect pricing warning', () => {
  it('shows warning when model has no built-in or custom pricing', async () => {
    mockFind.mockResolvedValue({
      data: [
        {
          model_id: 'custom-unknown-model',
          source: 'missing',
          price_input: null,
          price_output: null,
        },
      ],
      total: 1,
    });

    renderSelect();
    await waitFor(() => {
      expect(mockFind).toHaveBeenCalled();
    });
    expect(
      screen.getByText('No pricing data for this model — session cost will not be estimated.')
    ).toBeTruthy();
  });

  it('hides warning when model has custom pricing in usage_model_pricing', async () => {
    mockFind.mockResolvedValue({
      data: [
        {
          model_id: 'custom-unknown-model',
          source: 'custom',
          price_input: 1.5,
          price_cache_write: null,
          price_cache_read: 0.25,
          price_output: 6,
        },
      ],
      total: 1,
    });

    renderSelect();

    await waitFor(() => {
      expect(
        screen.queryByText('No pricing data for this model — session cost will not be estimated.')
      ).toBeNull();
    });
  });

  it('hides warning for built-in pricing table models without needing custom rows', async () => {
    mockFind.mockResolvedValue({ data: [], total: 0 });

    renderSelect({
      model: 'claude-sonnet-5-5',
      models: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }],
    });

    await waitFor(() => {
      expect(mockFind).toHaveBeenCalled();
    });
    expect(
      screen.queryByText('No pricing data for this model — session cost will not be estimated.')
    ).toBeNull();
  });
});
