import { useState } from 'react';
import { userAvatarBackground, userAvatarInitial } from '../utils/userAvatar.js';

const SIZE = {
  sm: { box: 'h-4 w-4', text: 'text-[9px] leading-none font-semibold' },
  md: { box: 'h-7 w-7', text: 'text-xs font-semibold' },
  lg: { box: 'h-8 w-8', text: 'text-sm font-semibold' },
  xl: { box: 'h-14 w-14', text: 'text-xl font-semibold' },
};

const BORDER = 'border border-fg/30';

/**
 * Round user image, or a capital initial on a name-hashed color when there is
 * no photo. Thin `fg` border so the disk stays visible on light and dark chrome.
 */
export default function UserAvatar({ user, size = 'md', className = '' }) {
  const [failed, setFailed] = useState(false);
  const name = user?.username ?? user?.name ?? '';
  const src = user?.avatar_url;
  const dims = SIZE[size] ?? SIZE.md;
  const extra = className?.trim() ?? '';

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className={`${dims.box} shrink-0 rounded-full object-cover ${BORDER} ${extra}`.trim()}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`inline-flex ${dims.box} shrink-0 items-center justify-center rounded-full text-on-solid ${BORDER} ${dims.text} ${extra}`.trim()}
      style={{ backgroundColor: userAvatarBackground(name) }}
    >
      {userAvatarInitial(name)}
    </span>
  );
}
