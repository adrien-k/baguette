export function SettingsSection({ title, description, children }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-300">{title}</h2>
        {description ? <p className="text-sm text-zinc-500 mt-1">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
