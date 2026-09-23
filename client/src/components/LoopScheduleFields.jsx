import { WEEKDAYS, INTERVAL_PRESETS, describeSchedule } from '../utils/loopSchedule.js';

const SCHEDULE_TABS = [
  { value: 'interval', label: 'Interval' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

const chipClass = (active) =>
  `px-2.5 py-1 rounded text-xs transition-colors border ${
    active
      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
  }`;

/**
 * Recurrence picker shared by the builder form's Loop tab and the edit modal.
 * `schedule` is the flat shape the loops service stores; `onChange` gets a whole new one.
 */
export default function LoopScheduleFields({ schedule, onChange }) {
  const set = (patch) => onChange({ ...schedule, ...patch });

  const toggleDay = (value) =>
    set({
      days_of_week: schedule.days_of_week.includes(value)
        ? schedule.days_of_week.filter((d) => d !== value)
        : [...schedule.days_of_week, value],
    });

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-300 mb-1.5">Recurrence</label>
      <div className="flex gap-1.5 mb-3">
        {SCHEDULE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => set({ schedule_type: tab.value })}
            className={`${chipClass(schedule.schedule_type === tab.value)} px-3 py-1.5 rounded-md`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {schedule.schedule_type === 'interval' ? (
        <select
          value={schedule.interval_minutes}
          onChange={(e) => set({ interval_minutes: Number(e.target.value) })}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        >
          {INTERVAL_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="space-y-3">
          {schedule.schedule_type === 'weekly' && (
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={chipClass(schedule.days_of_week.includes(d.value))}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={schedule.time_of_day}
              onChange={(e) => set({ time_of_day: e.target.value })}
              className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
            <span className="text-xs text-zinc-500">{schedule.timezone}</span>
          </div>
        </div>
      )}

      <p className="mt-2 text-xs text-zinc-500">{describeSchedule(schedule)}</p>
    </div>
  );
}
