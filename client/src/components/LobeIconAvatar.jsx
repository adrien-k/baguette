import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { loadLobeIconModule } from '../lib/lobeIconLoaders.js';

function parseSize(className, sizeProp) {
  if (typeof sizeProp === 'number' && sizeProp > 0) return sizeProp;
  const match = className?.match(/(?:^|\s)(?:w|h)-(\d+(?:\.\d+)?)/);
  if (match) return Math.round(parseFloat(match[1]) * 4);
  return 14;
}

/** Renders a Lobe brand avatar for a curated icon id. */
export default function LobeIconAvatar({ iconId, size, className = '' }) {
  const [Icon, setIcon] = useState(null);
  const pixelSize = parseSize(className, size);

  useEffect(() => {
    let cancelled = false;
    setIcon(null);
    loadLobeIconModule(iconId).then((component) => {
      if (!cancelled) setIcon(component);
    });
    return () => {
      cancelled = true;
    };
  }, [iconId]);

  if (!Icon?.Avatar) {
    return (
      <Bot
        className={className || 'w-3.5 h-3.5 shrink-0'}
        style={size ? { width: pixelSize, height: pixelSize } : undefined}
        aria-hidden
      />
    );
  }

  return <Icon.Avatar size={pixelSize} className={className} />;
}
