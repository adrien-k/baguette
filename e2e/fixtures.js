import { test as base, expect } from '@playwright/test';

/**
 * Theme-aware `test` re-export.
 *
 * When `E2E_THEME=light|dark` is set, every `page` from this fixture pre-seeds
 * `localStorage['baguette-color-scheme']` before any navigation, so `index.html`
 * applies the right theme in its inline boot script and ColorSchemeProvider
 * adopts it (dev users have no stored `color_scheme`, so nothing overrides it).
 * Screenshot helpers append a `-<theme>` suffix to file names, so a full capture
 * run produces parallel `<name>-dark.png` / `<name>-light.png` sets.
 *
 * Without `E2E_THEME` behavior is unchanged: default dark, plain file names.
 *
 * Pages created outside the fixture (e.g. `browser.newContext()` in share
 * tests) must call `applyE2eTheme(page)` before their first navigation.
 */

export const E2E_THEME =
  process.env.E2E_THEME === 'light' || process.env.E2E_THEME === 'dark'
    ? process.env.E2E_THEME
    : null;

/** Suffix for saved screenshot names (`-dark` / `-light`) when E2E_THEME is set. */
export function e2eThemeSuffix() {
  return E2E_THEME ? `-${E2E_THEME}` : '';
}

export function applyE2eTheme(page) {
  if (!E2E_THEME) return Promise.resolve();
  return page.addInitScript((scheme) => {
    try {
      localStorage.setItem('baguette-color-scheme', scheme);
    } catch {
      // ignore private mode / blocked storage
    }
  }, E2E_THEME);
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await applyE2eTheme(page);
    await use(page);
  },
});

export { expect };
