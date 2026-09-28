import {
  CARD_MUTED_CLASS,
  TEXT_HEADING,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SUCCESS,
} from '../utils/ui.js';
import { PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';

export function SettingsTabHeader({ title, children }) {
  return (
    <div className="mb-6">
      <h2 className={`text-lg font-semibold ${TEXT_PRIMARY}`}>{title}</h2>
      {children ? <p className={`text-sm ${TEXT_MUTED} mt-1 max-w-2xl`}>{children}</p> : null}
    </div>
  );
}

export function SettingsSection({ title, description, headerAside, children }) {
  return (
    <section className={`${CARD_MUTED_CLASS} p-4 sm:p-6 space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className={`text-sm font-semibold ${TEXT_HEADING}`}>{title}</h3>
          {description ? <p className="text-sm text-faint mt-1">{description}</p> : null}
        </div>
        {headerAside ? <div className="shrink-0 pt-0.5">{headerAside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsSaveRow({ saving, saved, onSave, disabled, children = 'Save' }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className={PRIMARY_BUTTON_SIZED}
      >
        {saving ? 'Saving…' : children}
      </button>
      {saved ? <span className={`text-sm ${TEXT_SUCCESS}`}>Saved</span> : null}
    </div>
  );
}
