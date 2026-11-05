import { useRef, useState } from 'react'
import { backupName, buildBackup, restoreBackup, shareFile, type Backup } from '../db/backup'
import { db } from '../db/db'
import { alive, movePlanned, removeCustomActivity, restoreCustomActivity, updateProfile } from '../db/repo'
import { dateForWeekday, todayKey, weekdayLong, weekStartOf } from '../domain/dates'
import { moveTab, normalizeTabOrder } from '../domain/sleep'
import { DEFAULT_TAB_ORDER } from '../domain/types'
import type { CustomActivityKey, IsoWeekday, Profile, TabKey, Units } from '../domain/types'
import { useProfile, useProtocol } from '../hooks'
import { useUi } from '../store'
import { Button, Field, intensityColor, Segmented, Sheet, Stepper, Toggle } from '../ui/primitives'

export const UNIT_OPTIONS: { value: Units; label: string }[] = [
  { value: 'imperial', label: 'Imperial (lb, mi, °F)' },
  { value: 'metric', label: 'Metric (kg, km, °C)' },
]

/** Changing the rest day also moves this week's rest day, unless that day already passed. */
export async function changeRestDay(wd: IsoWeekday) {
  await updateProfile({ restDay: wd })
  const ws = weekStartOf(todayKey())
  const target = dateForWeekday(ws, wd)
  if (target < todayKey()) return
  const rest = alive(await db.plannedSessions.where('weekStart').equals(ws).toArray()).find((p) => p.activityType === 'rest')
  if (rest && rest.date >= todayKey()) await movePlanned(rest.id, target)
}

export function SettingsSheet() {
  const p = useProfile()
  if (!p) return null
  const set = (patch: Partial<Profile>) => void updateProfile(patch)
  return (
    <Sheet title="Settings">
      <Field label="Units" hint="Stored in metric; switching only changes how values are shown.">
        <Segmented label="Units" value={p.units} options={UNIT_OPTIONS.map((o) => ({ ...o, label: o.value === 'imperial' ? 'Imperial' : 'Metric' }))} onChange={(units) => set({ units })} />
      </Field>

      <TabOrder profile={p} />

      <Field label="Bedtime" hint="Caffeine, exercise and shower times are worked out from this. Set different nights from the Sleep tab.">
        <input
          type="time"
          value={p.bedtimeDefault}
          onChange={(e) => e.target.value && set({ bedtimeDefault: e.target.value })}
          className="num min-h-12 rounded-xl border border-line bg-surface px-3 text-lg"
        />
      </Field>

      <Field label="Usual wake time">
        <input
          type="time"
          value={p.wakeDefault}
          onChange={(e) => e.target.value && set({ wakeDefault: e.target.value })}
          className="num min-h-12 rounded-xl border border-line bg-surface px-3 text-lg"
        />
      </Field>

      <Field label="Rest day">
        <RestDayPicker value={p.restDay} onChange={(wd) => void changeRestDay(wd)} />
      </Field>

      <Field label="Weekly cardio floor" hint="Moderate-equivalent minutes. Vigorous minutes count double.">
        <Stepper label="cardio floor" value={p.cardioFloorMin} step={10} min={30} max={p.cardioTargetMin} onChange={(v) => set({ cardioFloorMin: v })} format={(v) => `${v} min`} />
      </Field>
      <Field label="Weekly cardio target">
        <Stepper label="cardio target" value={p.cardioTargetMin} step={10} min={p.cardioFloorMin} max={1200} onChange={(v) => set({ cardioTargetMin: v })} format={(v) => `${v} min`} />
      </Field>

      <Field label="Bike commute leg">
        <Stepper label="commute minutes" value={p.commuteDefaultMin} step={1} min={1} max={180} onChange={(v) => set({ commuteDefaultMin: v })} format={(v) => `${v} min`} />
      </Field>

      <Field label="Strength rest timer">
        <Stepper label="rest timer" value={p.restTimerSec} step={15} min={15} max={300} onChange={(v) => set({ restTimerSec: v })} format={(v) => `${v} s`} />
      </Field>

      <OwnActivities />

      <div className="mb-6 border-t border-line pt-2">
        <Toggle label="Track wine (at most 1 glass a day)" checked={p.wineEnabled} onChange={(wineEnabled) => set({ wineEnabled })} />
      </div>

      <BackupRestore />

      <p className="pb-4 text-sm text-ink-3">
        This app tracks habits and is not a medical device. Check with a doctor before starting a demanding programme. Your data stays on this phone.
      </p>
    </Sheet>
  )
}

export function RestDayPicker({ value, onChange }: { value: IsoWeekday; onChange: (wd: IsoWeekday) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1" role="radiogroup" aria-label="Rest day" data-small-ok>
      {([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[]).map((wd) => (
        <button
          key={wd}
          role="radio"
          aria-checked={value === wd}
          aria-label={weekdayLong(wd)}
          onClick={() => onChange(wd)}
          className={`min-h-12 rounded-lg text-sm font-medium ${value === wd ? 'bg-ink text-bg' : 'bg-sunk text-ink-2'}`}
        >
          {weekdayLong(wd).slice(0, 2)}
        </button>
      ))}
    </div>
  )
}

function OwnActivities() {
  const protocol = useProtocol()
  const toast = useUi((s) => s.showToast)
  const own = protocol?.activityTypes.filter((a) => a.custom && !a.hidden) ?? []
  return (
    <Field label="Your activities" hint={own.length ? 'Removing one hides it from the log list; past sessions keep it.' : 'Add one from Log activity, then New activity.'}>
      {own.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {own.map((a) => (
            <li key={a.key} className="flex min-h-14 items-center justify-between gap-3 pl-4">
              <span className="min-w-0">
                <span className="block truncate font-medium">{a.label}</span>
                <span className="flex items-center gap-1.5 text-sm text-ink-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: intensityColor(a.defaultIntensity) }} />
                  {a.defaultIntensity}
                  {a.isCardio ? ', counts as cardio' : ', not cardio'}
                </span>
              </span>
              <button
                className="min-h-12 shrink-0 px-4 text-sm font-medium text-red"
                onClick={async () => {
                  await removeCustomActivity(a.key as CustomActivityKey)
                  toast({ message: `${a.label} removed`, action: { label: 'Undo', run: () => void restoreCustomActivity(a.key as CustomActivityKey) } })
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  )
}

const TAB_NAMES: Record<TabKey, string> = { today: 'Today', sleep: 'Sleep', eat: 'Eat', train: 'Train', week: 'Week' }

function TabOrder({ profile }: { profile: Profile }) {
  const order = normalizeTabOrder(profile.tabOrder)
  const isDefault = order.join() === DEFAULT_TAB_ORDER.join()
  const move = (t: TabKey, delta: -1 | 1) => void updateProfile({ tabOrder: moveTab(order, t, delta) })
  return (
    <Field label="Tab order" hint="The first tab opens when you start the app.">
      <ol className="divide-y divide-line rounded-xl border border-line">
        {order.map((t, i) => (
          <li key={t} className="flex min-h-14 items-center gap-2 pl-4 pr-1">
            <span className="num w-5 text-sm text-ink-3">{i + 1}</span>
            <span className="flex-1 font-medium">{TAB_NAMES[t]}</span>
            <button
              className="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-ink-2 active:bg-sunk disabled:opacity-25"
              disabled={i === 0}
              onClick={() => move(t, -1)}
              aria-label={`Move ${TAB_NAMES[t]} up`}
            >
              <Chevron up />
            </button>
            <button
              className="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-ink-2 active:bg-sunk disabled:opacity-25"
              disabled={i === order.length - 1}
              onClick={() => move(t, 1)}
              aria-label={`Move ${TAB_NAMES[t]} down`}
            >
              <Chevron />
            </button>
          </li>
        ))}
      </ol>
      {!isDefault && (
        <button className="mt-1 min-h-11 text-sm font-medium text-moderate" onClick={() => void updateProfile({ tabOrder: [...DEFAULT_TAB_ORDER] })}>
          Reset to default order
        </button>
      )}
    </Field>
  )
}

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={up ? 'M5 12.5l5-5 5 5' : 'M5 7.5l5 5 5-5'} />
    </svg>
  )
}

/** Export a full backup, or replace everything on this phone with one (two taps, with what's in the file shown first). */
function BackupRestore() {
  const toast = useUi((s) => s.showToast)
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ backup: Backup; rows: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file: File | undefined) => {
    setError(null)
    setPending(null)
    if (!file) return
    try {
      const backup = JSON.parse(await file.text()) as Backup
      if (backup?.app !== 'brain-health' || !backup.tables) throw new Error('That file isn’t a Brain Health backup.')
      setPending({ backup, rows: Object.values(backup.tables).reduce((a, t) => a + (Array.isArray(t) ? t.length : 0), 0) })
    } catch (e) {
      setError(e instanceof SyntaxError ? 'That file isn’t a Brain Health backup.' : (e as Error).message)
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  const restore = async () => {
    if (!pending) return
    try {
      await restoreBackup(pending.backup)
      window.location.reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Field label="Backup and restore" hint="Restoring replaces everything on this phone with the backup.">
      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await shareFile(backupName(), JSON.stringify(await buildBackup()), 'application/json')
            } catch (e) {
              if (!/cancel/i.test(String(e))) toast({ message: `Export failed: ${(e as Error).message}` })
            }
          }}
        >
          Export full backup
        </Button>
        <Button variant="outline" onClick={() => input.current?.click()}>
          Restore from a backup file
        </Button>
        <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {error && <p className="mt-2 text-sm text-red">{error}</p>}
      {pending && (
        <div className="mt-3 rounded-xl bg-amber-soft p-3 text-sm">
          <p>
            Backup from {new Date(pending.backup.exportedAt).toLocaleString()}, {pending.rows} records. This replaces all data on this phone.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="quiet" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={() => void restore()}>
              Replace and restore
            </Button>
          </div>
        </div>
      )}
    </Field>
  )
}
