import { describe, it, expect, beforeEach } from 'vitest';

process.env.PUBLIC_API_HOST = 'https://preview.example.com';

const { buildDeepLinkUrl, normalizePreviewScheme, getPreviewServiceDefinitions } =
  await import('../preview-services.js');

describe('preview-services', () => {
  beforeEach(() => {
    process.env.PUBLIC_API_URL = 'https://app.example.com';
  });

  it('normalizePreviewScheme adds :// when missing', () => {
    expect(normalizePreviewScheme('exp')).toBe('exp://');
    expect(normalizePreviewScheme('exp://')).toBe('exp://');
  });

  it('buildDeepLinkUrl replaces https scheme', () => {
    const url = buildDeepLinkUrl('exp://', 'https://session-abc123-expo.preview.example.com/');
    expect(url).toBe('exp://session-abc123-expo.preview.example.com/');
  });

  it('getPreviewServiceDefinitions for webserver', () => {
    const defs = getPreviewServiceDefinitions(
      {
        preview: { scheme: 'exp://' },
        session: { tasks: { dev: { run: 'vite', ports: ['VITE_PORT'] } } },
        webserver: { task: 'dev', expose: 'VITE_PORT' },
      },
      'abc123'
    );
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('default');
    expect(defs[0].task_label).toBe('baguette:webserver:default');
    expect(defs[0].deep_link_url).toContain('exp://session-abc123');
  });

  it('getPreviewServiceDefinitions for multi-service with per-service scheme', () => {
    const defs = getPreviewServiceDefinitions(
      {
        session: {
          tasks: {
            api: { run: 'node api', ports: ['API_PORT'] },
            expo: { run: 'expo', ports: ['EXPO_PORT'] },
          },
        },
        services: {
          api: { task: 'api', expose: 'API_PORT' },
          expo: { task: 'expo', expose: 'EXPO_PORT', scheme: 'exp://' },
        },
      },
      'xyz9'
    );
    expect(defs).toHaveLength(2);
    expect(defs.find((d) => d.name === 'expo').deep_link_url).toMatch(/^exp:\/\//);
    expect(defs.find((d) => d.name === 'api').deep_link_url).toBeNull();
  });
});
