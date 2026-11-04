import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import {
  addDrinkPreset,
  deleteCaffeine,
  deleteSleepLog,
  restoreCaffeine,
  saveSleepLog,
  updateCaffeine,
  updateDrinkPreset,
  updateProfile,
} from '../db/repo'
import { atMinutes, formatDuration, formatTime, fromDateKey, hmToMinutes, weekdayLong } from '../domain/dates'
import { nightTimes, QUALITY_LABELS } from '../domain/sleep'
import { bedtimeFor, cutoffsFor } from '../domain/sleepTimes'
import type { CaffeineLog, IsoWeekday, SleepLog } from '../domain/types'
import { useProfile, useProtocol } from '../hooks'
import { QualityPicker } from '../screens/Sleep'
import { useUi } from '../store'
import { Button, cx, Field, Sheet, Stepper } from '../ui/primitives'

const timeInput = 'num min-h-12 rounded-xl border border-line bg-surface px-3 text-lg'

export function SleepLogSheet({ night }: { night: string }) {
  const profile = useProfile()
  const existing = useLiveQuery(async () => (await db.sleepLogs.where('night').equals(night).first()) ?? null, [night])
  if (!profile || existing === undefined) return null
  const log = existing && !existing.deletedAt ? existing : undefined
  return <SleepLogForm key={log?.id ?? 'new'} night={night} log={log} bed={log ? format(log.bedAt, 'HH:mm') : bedtimeFor(night, profile)} wake={log ? format(log.wakeAt, 'HH:mm') : profile.wakeDefault} />
}

function SleepLogForm({ night, log, bed: bed0, wake: wake0 }: { night: string; log?: SleepLog; bed: string; wake: string }) {
  const close = useUi((s) => s.close)
  const toast = useUi((s) => s.showToast)
  const [bed, setBed] = useState(bed0)
  const [wake, setWake] = useState(wake0)
  const [quality, setQuality] = useState<SleepLog['quality'] | undefined>(log?.quality)
  const [note, setNote] = useState(log?.note ?? '')
  const t = nightTimes(night, bed, wake)
  const mins = Math.round((t.wakeAt - t.bedAt) / 60000)

  const save = async () => {
    if (!quality) return
    await saveSleepLog({ night, ...t, quality, note: note.trim() || undefined })
    close()
    toast({ message: `Night saved: ${formatDuration(mins)}, ${QUALITY_LABELS[quality - 1].toLowerCase()}` })
  }

  return (
    <Sheet title={`${format(fromDateKey(night), 'EEEE')} night`}>
      <div className="mb-5 flex gap-4">
        <label className="flex-1">
          <span className="mb-2 block text-sm font-medium text-ink-2">Went to bed</span>
          <input type="time" value={bed} onChange={(e) => e.target.value && setBed(e.target.value)} className={cx(timeInput, 'w-full')} />
        </label>
        <label className="flex-1">
          <span className="mb-2 block text-sm font-medium text-ink-2">Woke up</span>
          <input type="time" value={wake} onChange={(e) => e.target.value && setWake(e.target.value)} className={cx(timeInput, 'w-full')} />
        </label>
      </div>
      <p className="-mt-2 mb-5 text-sm text-ink-2">
        <span className="num text-lg font-semibold text-ink">{formatDuration(mins)}</span> in bed, {format(t.bedAt, 'EEE h:mm a')} to {format(t.wakeAt, 'EEE h:mm a')}
      </p>
      <Field label="How well did you sleep?">
        <QualityPicker value={quality} onPick={setQuality} />
      </Field>
      <Field label="Note">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="min-h-12 w-full rounded-xl border border-line bg-surface px-3" />
      </Field>
      <div className="flex gap-2 pb-2">
        {log && (
          <Button
            variant="danger"
            onClick={async () => {
              await deleteSleepLog(log.id)
              close()
              toast({ message: 'Night deleted', action: { label: 'Undo', run: () => void saveSleepLog({ night, bedAt: log.bedAt, wakeAt: log.wakeAt, quality: log.quality, note: log.note }) } })
            }}
          >
            Delete
          </Button>
        )}
        <Button className="flex-1" onClick={save} disabled={!quality}>
          {quality ? 'Save night' : 'Pick how you slept'}
        </Button>
      </div>
    </Sheet>
  )
}

/** F3.1: default bedtime with optional per-weekday overrides; cutoffs shown live. */
export function BedtimeSheet() {
  const profile = useProfile()
  const protocol = useProtocol()
  if (!profile || !protocol) return null
  const c = cutoffsFor('2026-01-05', { bedtimeDefault: profile.bedtimeDefault, bedtimeByWeekday: {} }, protocol.sleepRules)
  const setOverride = (wd: IsoWeekday, hm: string | undefined) => {
    const next = { ...profile.bedtimeByWeekday }
    if (hm) next[wd] = hm
    else delete next[wd]
    void updateProfile({ bedtimeByWeekday: next })
  }
  return (
    <Sheet title="Bedtime">
      <div className="mb-5 flex gap-4">
        <label className="flex-1">
          <span className="mb-2 block text-sm font-medium text-ink-2">Usual bedtime</span>
          <input type="time" value={profile.bedtimeDefault} onChange={(e) => e.target.value && void updateProfile({ bedtimeDefault: e.target.value })} className={cx(timeInput, 'w-full')} />
        </label>
        <label className="flex-1">
          <span className="mb-2 block text-sm font-medium text-ink-2">Usual wake time</span>
          <input type="time" value={profile.wakeDefault} onChange={(e) => e.target.value && void updateProfile({ wakeDefault: e.target.value })} className={cx(timeInput, 'w-full')} />
        </label>
      </div>
      <dl className="mb-6 grid grid-cols-3 gap-2 rounded-xl bg-sunk p-3 text-sm">
        <div>
          <dt className="text-ink-2">Last caffeine</dt>
          <dd className="num font-semibold">{formatTime(c.caffeineCutoff)}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Hard exercise by</dt>
          <dd className="num font-semibold">{formatTime(c.exerciseCutoff)}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Warm shower</dt>
          <dd className="num font-semibold">{formatTime(c.shower)}</dd>
        </div>
      </dl>
      <Field label="Different bedtime on some nights" hint="For example a later bedtime on Friday and Saturday.">
        <ul className="divide-y divide-line rounded-xl border border-line">
          {([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[]).map((wd) => {
            const own = profile.bedtimeByWeekday[wd]
            return (
              <li key={wd} className="flex min-h-14 items-center justify-between gap-2 pl-4 pr-1">
                <span className="font-medium">{weekdayLong(wd)}</span>
                {own ? (
                  <span className="flex items-center gap-1">
                    <input type="time" aria-label={`${weekdayLong(wd)} bedtime`} value={own} onChange={(e) => e.target.value && setOverride(wd, e.target.value)} className="num min-h-11 rounded-lg border border-line bg-surface px-2" />
                    <button className="min-h-12 px-3 text-sm text-ink-2" onClick={() => setOverride(wd, undefined)}>
                      Use usual
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center">
                    <span className="text-sm text-ink-3">Usual</span>
                    <button className="min-h-12 px-3 text-sm font-medium text-moderate" onClick={() => setOverride(wd, profile.bedtimeDefault)} aria-label={`Set a different bedtime for ${weekdayLong(wd)}`}>
                      Change
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </Field>
    </Sheet>
  )
}

/** F3.5: preset drinks with editable caffeine, hide/show, and custom drinks. */
export function DrinksSheet() {
  const drinks = useLiveQuery(() => db.drinkPresets.orderBy('sort').toArray(), [])
  const [name, setName] = useState('')
  const [mg, setMg] = useState(80)
  if (!drinks) return null
  const add = async () => {
    if (!name.trim()) return
    await addDrinkPreset(name, mg)
    setName('')
  }
  return (
    <Sheet title="Drinks">
      <p className="mb-4 text-sm text-ink-2">Amounts are typical servings. Set yours to match what you actually drink; past entries keep the amount logged at the time.</p>
      <ul className="mb-6 divide-y divide-line rounded-xl border border-line">
        {drinks.map((d) => (
          <li key={d.key} className={cx('px-3 py-2', d.hidden && 'opacity-60')}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{d.label}</span>
              <button className="min-h-11 px-2 text-sm text-ink-2" onClick={() => void updateDrinkPreset(d.key, { hidden: !d.hidden })}>
                {d.hidden ? 'Show' : 'Hide'}
              </button>
            </div>
            {!d.hidden && <Stepper label={`${d.label} caffeine`} value={d.defaultMg} step={5} min={0} max={600} onChange={(v) => void updateDrinkPreset(d.key, { defaultMg: v })} format={(v) => `${v} mg`} />}
          </li>
        ))}
      </ul>
      <Field label="Add a drink">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="Cold brew, matcha…" className="mb-3 min-h-12 w-full rounded-xl border border-line bg-surface px-3" />
        <Stepper label="new drink caffeine" value={mg} step={5} min={0} max={600} onChange={setMg} format={(v) => `${v} mg`} />
        <Button className="mt-3 w-full" onClick={add} disabled={!name.trim()}>
          Add drink
        </Button>
      </Field>
    </Sheet>
  )
}

/** Fix the time or amount of a drink already logged (e.g. logged late). */
export function DrinkEditSheet({ log }: { log: CaffeineLog }) {
  const close = useUi((s) => s.close)
  const toast = useUi((s) => s.showToast)
  const [time, setTime] = useState(format(log.at, 'HH:mm'))
  const [mg, setMg] = useState(log.mg)
  const save = async () => {
    await updateCaffeine(log.id, { at: atMinutes(log.date, hmToMinutes(time)), mg })
    close()
  }
  return (
    <Sheet title={log.label}>
      <Field label="Time">
        <input type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} className={timeInput} />
      </Field>
      <Field label="Caffeine">
        <Stepper label="caffeine" value={mg} step={5} min={0} max={600} onChange={setMg} format={(v) => `${v} mg`} />
      </Field>
      <div className="flex gap-2 pb-2">
        <Button
          variant="danger"
          onClick={async () => {
            await deleteCaffeine(log.id)
            close()
            toast({ message: `${log.label} removed`, action: { label: 'Undo', run: () => void restoreCaffeine(log.id) } })
          }}
        >
          Remove
        </Button>
        <Button className="flex-1" onClick={save}>
          Save changes
        </Button>
      </div>
    </Sheet>
  )
}
