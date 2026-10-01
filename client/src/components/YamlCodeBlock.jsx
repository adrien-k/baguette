import { useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('yaml', yaml);

export default function YamlCodeBlock({ source, className = '' }) {
  const html = useMemo(() => {
    if (!source) return '';
    try {
      return hljs.highlight(source, { language: 'yaml' }).value;
    } catch {
      return hljs.highlightAuto(source).value;
    }
  }, [source]);

  return (
    <pre
      className={`yaml-code text-xs font-mono leading-5 overflow-x-auto m-0 whitespace-pre ${className}`}
    >
      <code className="hljs language-yaml" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
