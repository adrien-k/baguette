import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'dark' });

let idCounter = 0;

export default function MermaidChart({ chart }) {
  const ref = useRef(null);
  const [error, setError] = useState(null);
  const id = useRef(`mermaid-${++idCounter}`);

  useEffect(() => {
    let cancelled = false;
    setError(null);
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
  }, [chart]);

  if (error) {
    return (
      <pre className="bg-zinc-800 border border-red-700 text-red-400 text-xs p-3 rounded-lg overflow-auto my-2">
        {error}
      </pre>
    );
  }

  return <div ref={ref} className="my-2 flex justify-center overflow-auto" />;
}
