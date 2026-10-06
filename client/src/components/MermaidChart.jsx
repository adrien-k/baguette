import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { useColorScheme } from '../hooks/useColorScheme.jsx';
import MermaidFallback from './MermaidFallback.jsx';

let idCounter = 0;

export default function MermaidChart({ chart }) {
  const { colorScheme } = useColorScheme();
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  const id = useRef(`mermaid-${++idCounter}`);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    mermaid.initialize({
      startOnLoad: false,
      theme: colorScheme === 'light' ? 'default' : 'dark',
    });
    mermaid
      .render(id.current, chart)
      .then(({ svg }) => {
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      })
      .catch((err) => {
        // Surface for devtools only — the chat should never see a raw Mermaid
        // "Syntax error in text" message. MermaidFallback renders the source.
        // eslint-disable-next-line no-console
        console.warn('Mermaid render failed:', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [chart, colorScheme]);

  if (failed) return <MermaidFallback chart={chart} />;

  return <div ref={ref} className="my-2 flex justify-center overflow-auto" />;
}
