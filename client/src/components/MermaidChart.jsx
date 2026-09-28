import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { useColorScheme } from '../hooks/useColorScheme.jsx';

let idCounter = 0;

export default function MermaidChart({ chart }) {
  const { colorScheme } = useColorScheme();
  const ref = useRef(null);
  const [error, setError] = useState(null);
  const id = useRef(`mermaid-${++idCounter}`);

  useEffect(() => {
    let cancelled = false;
    setError(null);
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
        if (!cancelled) setError(err.message || 'Failed to render diagram');
      });
    return () => {
      cancelled = true;
    };
  }, [chart, colorScheme]);

  if (error) {
    return (
      <pre className="bg-control border border-red-700 text-danger text-xs p-3 rounded-lg overflow-auto my-2">
        {error}
      </pre>
    );
  }

  return <div ref={ref} className="my-2 flex justify-center overflow-auto" />;
}
