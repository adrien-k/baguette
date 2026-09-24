export function SettingsTabHeader({ title, children }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {children ? <p className="text-sm text-zinc-400 mt-1 max-w-2xl">{children}</p> : null}
    </div>
  );
}

export function SettingsSection({ title, description, children }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
        {description ? <p className="text-sm text-zinc-500 mt-1">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
