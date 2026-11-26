import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SessionFilesPanel from '../SessionFilesPanel.jsx';
import { compileFileFilters } from '../../../utils/fileFilters.js';

const FILES = [
  { oldPath: 'client/src/app.jsx', newPath: 'client/src/app.jsx', addedCount: 2, removedCount: 1 },
  {
    oldPath: 'client/src/app.test.jsx',
    newPath: 'client/src/app.test.jsx',
    addedCount: 5,
    removedCount: 0,
  },
  { oldPath: 'server/app.js', newPath: 'server/app.js', addedCount: 1, removedCount: 3 },
];

function makeFilters(includePattern = '', excludePattern = '') {
  return {
    includePattern,
    excludePattern,
    setIncludePattern: () => {},
    setExcludePattern: () => {},
    clear: () => {},
    compiled: compileFileFilters(includePattern, excludePattern),
  };
}

function renderPanel(props = {}) {
  return renderToStaticMarkup(
    createElement(SessionFilesPanel, {
      diffFiles: FILES,
      filesLoading: false,
      selectedFilePath: null,
      onSelectFile: () => {},
      onRefresh: () => {},
      unavailable: false,
      ...props,
    })
  );
}

describe('SessionFilesPanel', () => {
  it('lists every changed file when no filters are set', () => {
    const html = renderPanel({ fileFilters: makeFilters() });
    expect(html).toContain('>app.jsx</span>');
    expect(html).toContain('>app.test.jsx</span>');
    expect(html).toContain('>app.js</span>');
    expect(html).toContain('>server</span>');
    expect(html).not.toContain('Clear filters');
  });

  it('renders a collapsed filters toggle when no filters are set', () => {
    const html = renderPanel({ fileFilters: makeFilters() });
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('files-include-filter');
  });

  it('auto-expands the filter section when filters are already set', () => {
    const html = renderPanel({ fileFilters: makeFilters('', 'node_modules') });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('files-include-filter');
    expect(html).toContain('files-exclude-filter');
    expect(html).toContain('Include');
    expect(html).toContain('Exclude');
  });

  it('filters the list by the include regex and shows the match count', () => {
    const html = renderPanel({ fileFilters: makeFilters('\\.jsx$') });
    expect(html).toContain('>app.jsx</span>');
    expect(html).toContain('>app.test.jsx</span>');
    expect(html).toContain('>app.js</span>');
    expect(html).toContain('Showing 2 of 3 files');
    expect(html).toContain('Clear filters');
    expect(html).toContain('opacity-50');
  });

  it('applies the exclude regex on top of the include regex', () => {
    const html = renderPanel({ fileFilters: makeFilters('\\.jsx$', '\\.test\\.') });
    expect(html).toContain('>app.jsx</span>');
    expect(html).toContain('>app.test.jsx</span>');
    expect(html).toContain('Showing 1 of 3 files');
  });

  it('shows an inline error and keeps the full list for an invalid regex', () => {
    const html = renderPanel({ fileFilters: makeFilters('a(') });
    expect(html).toContain('files-include-filter');
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain('Showing'); // nothing is filtered
    expect(html).toContain('>app.jsx</span>');
    expect(html).toContain('>app.js</span>');
    expect(html).toContain('Clear filters');
  });

  it('lists filter exclusions greyed when nothing matches', () => {
    const html = renderPanel({ fileFilters: makeFilters('does-not-match-anything') });
    expect(html).toContain('Showing 0 of 3 files');
    expect(html).toContain('>app.jsx</span>');
    expect(html).toContain('opacity-50');
    expect(html).not.toContain('No files match the current filters.');
  });
});
