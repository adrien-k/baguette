import { Moon, Sun } from 'lucide-react';
import { useColorScheme } from '../hooks/useColorScheme.jsx';

const MENU_ITEM_CLASS =
  'flex items-center gap-2.5 w-full text-left px-4 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-700/50 transition-colors';

export default function ColorSchemeToggle({ menuItem = false }) {
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const isLight = colorScheme === 'light';
  const label = isLight ? 'Dark mode' : 'Light mode';
  const Icon = isLight ? Moon : Sun;

  if (menuItem) {
    return (
      <button type="button" onClick={toggleColorScheme} className={MENU_ITEM_CLASS}>
        <Icon className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleColorScheme}
      className="flex items-center justify-center w-9 h-9 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors"
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      title={label}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
