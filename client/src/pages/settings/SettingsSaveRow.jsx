export function SettingsSaveRow({ saving, saved, onSave, disabled }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved && <span className="text-sm text-emerald-400">Saved</span>}
    </div>
  );
}
