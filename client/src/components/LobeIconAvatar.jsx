import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { loadLobeIconUrl } from '../lib/lobeIconLoaders.js';

function parseSize(className, sizeProp) {
  if (typeof sizeProp === 'number' && sizeProp > 0) return sizeProp;
  const match = className?.match(/(?:^|\s)(?:w|h)-(\d+(?:\.\d+)?)/);
  if (match) return Math.round(parseFloat(match[1]) * 4);
  return 14;
}

/** Renders a Lobe brand avatar for a curated icon id. */
export default function LobeIconAvatar({ iconId, size, className = '' }) {
  const [src, setSrc] = useState(null);
  const pixelSize = parseSize(className, size);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    loadLobeIconUrl(iconId).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [iconId]);

  if (!src) {
    return (
      <Bot
        className={className || 'w-3.5 h-3.5 shrink-0'}
        style={size ? { width: pixelSize, height: pixelSize } : undefined}
        aria-hidden
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={`${className} rounded-full object-cover`}
      width={pixelSize}
      height={pixelSize}
      aria-hidden
    />
  );
}
