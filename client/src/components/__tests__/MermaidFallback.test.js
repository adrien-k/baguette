import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MermaidFallback from '../MermaidFallback.jsx';

describe('MermaidFallback', () => {
  it('renders the diagram source as a code block instead of a Mermaid error', () => {
    const source = 'flowchart LR\n  A --> B';
    const html = renderToStaticMarkup(createElement(MermaidFallback, { chart: source }));

    expect(html).toContain('data-mermaid-fallback="true"');
    expect(html).toContain('Diagram could not be rendered');
    expect(html).toContain('A --&gt; B');
    // The raw Mermaid error phrase must not leak into the rendered view.
    expect(html).not.toContain('Syntax error in text');
  });

  it('preserves the source verbatim (no extra escaping of graph text)', () => {
    const source = 'flowchart LR\n  A["Node <one>"] --> B["C & D"]';
    const html = renderToStaticMarkup(createElement(MermaidFallback, { chart: source }));
    expect(html).toContain('A[&quot;Node &lt;one&gt;&quot;]');
    expect(html).toContain('B[&quot;C &amp; D&quot;]');
  });
});
