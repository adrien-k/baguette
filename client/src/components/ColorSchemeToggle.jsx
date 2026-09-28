import { Moon, Sun } from 'lucide-react';
import { useColorScheme } from '../hooks/useColorScheme.jsx';
import { MENU_ITEM_CLASS } from '../utils/ui.js';

export default function ColorSchemeToggle({ menuItem = false }) {
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const isLight = colorScheme === 'light';
  const label = isLight ? 'Dark mode' : 'Light mode';
  const Icon = isLight ? Moon : Sun;

  if (menuItem) {
    return (
      <button type="button" onClick={toggleColorScheme} className={MENU_ITEM_CLASS}>
        <Icon className="w-4 h-4 text-faint shrink-0" aria-hidden />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleColorScheme}
      className="flex items-center justify-center w-9 h-9 rounded-md text-fg-muted hover:text-fg hover:bg-control/50 transition-colors"
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      title={label}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
