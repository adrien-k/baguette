import { useId } from 'react';

/** In-app baguette mark (same artwork as `/baguette.svg`). */
export default function BaguetteIcon({ className }) {
  const rawId = useId().replace(/:/g, '');
  const bodyGrad = `body-grad-${rawId}`;
  const scoreGrad = `score-grad-${rawId}`;
  const dropshadow = `dropshadow-${rawId}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bodyGrad} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffd166" />
          <stop offset="45%" stopColor="#f5a523" />
          <stop offset="100%" stopColor="#c97c10" />
        </linearGradient>
        <linearGradient id={scoreGrad} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#b86808" />
          <stop offset="100%" stopColor="#a05a05" />
        </linearGradient>
        <filter id={dropshadow} x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#00000050" />
        </filter>
      </defs>

      <g transform="rotate(-38 32 32)" filter={`url(#${dropshadow})`}>
        <rect x="5" y="25" width="54" height="14" rx="7" fill={`url(#${bodyGrad})`} />
        <rect x="10" y="26.5" width="44" height="4" rx="2" fill="white" opacity="0.22" />
        <ellipse
          cx="19"
          cy="32"
          rx="2.2"
          ry="4.5"
          fill={`url(#${scoreGrad})`}
          opacity="0.75"
          transform="rotate(12 19 32)"
        />
        <ellipse
          cx="32"
          cy="32"
          rx="2.2"
          ry="4.5"
          fill={`url(#${scoreGrad})`}
          opacity="0.75"
          transform="rotate(12 32 32)"
        />
        <ellipse
          cx="45"
          cy="32"
          rx="2.2"
          ry="4.5"
          fill={`url(#${scoreGrad})`}
          opacity="0.75"
          transform="rotate(12 45 32)"
        />
      </g>
    </svg>
  );
}
