import { WEEKDAYS, INTERVAL_PRESETS, describeSchedule } from '../utils/loopSchedule.js';
import { chipOptionClassName } from './LightChipDropdown.jsx';
import { INPUT_CLASS, TEXT_FAINT, TEXT_SECONDARY } from '../utils/ui.js';

const SCHEDULE_TABS = [
  { value: 'interval', label: 'Interval' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

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
      <label className={`block text-sm font-medium ${TEXT_SECONDARY} mb-1.5`}>Recurrence</label>
      <div className="flex gap-1.5 mb-3">
        {SCHEDULE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => set({ schedule_type: tab.value })}
            className={`${chipOptionClassName(schedule.schedule_type === tab.value)} px-3 py-1.5 rounded-md`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {schedule.schedule_type === 'interval' ? (
        <select
          value={schedule.interval_minutes}
          onChange={(e) => set({ interval_minutes: Number(e.target.value) })}
          className={INPUT_CLASS}
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
                  className={chipOptionClassName(schedule.days_of_week.includes(d.value))}
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
              className={`${INPUT_CLASS} w-auto`}
            />
            <span className={`text-xs ${TEXT_FAINT}`}>{schedule.timezone}</span>
          </div>
        </div>
      )}

      <p className={`mt-2 text-xs ${TEXT_FAINT}`}>{describeSchedule(schedule)}</p>
    </div>
  );
}
