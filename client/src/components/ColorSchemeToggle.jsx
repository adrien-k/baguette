import { Moon, Sun } from 'lucide-react';
import { useColorScheme } from '../hooks/useColorScheme.jsx';

export default function ColorSchemeToggle() {
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const isLight = colorScheme === 'light';

  return (
    <button
      type="button"
      onClick={toggleColorScheme}
      className="flex items-center justify-center w-9 h-9 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors"
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      title={isLight ? 'Dark mode' : 'Light mode'}
    >
      {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
    </button>
  );
}
