import { Link } from 'react-router-dom';
import BaguetteIcon from '../components/svg/BaguetteIcon.jsx';
import { PAGE_BG } from '../utils/ui.js';

export default function NotFound({ title = 'Page not found', message }) {
  return (
    <div
      className={`min-h-full flex-1 ${PAGE_BG} flex items-center justify-center relative overflow-hidden px-4 py-16`}
    >
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[500px] bg-brand/[0.06] rounded-full blur-3xl" />
      </div>

      <div className="relative text-center max-w-sm w-full px-4">
        <BaguetteIcon className="w-16 h-16 mx-auto mb-4" />
        <p className="text-6xl font-display font-semibold text-faint mb-2" aria-hidden>
          404
        </p>
        <h1 className="text-xl font-semibold text-fg mb-2">{title}</h1>
        {message ? (
          <p className="text-sm text-fg-muted mb-8">{message}</p>
        ) : (
          <div className="mb-8" />
        )}
        <Link
          to="/"
          className="text-sm font-medium text-accent hover:text-accent/80 transition-colors"
        >
          Back to Baguette
        </Link>
      </div>
    </div>
  );
}
