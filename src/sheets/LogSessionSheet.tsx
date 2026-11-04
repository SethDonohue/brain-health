import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { db } from '../db/db'
import { addCustomActivity, deleteSession, logSession, updateSession } from '../db/repo'
import { addDaysKey, formatDuration, formatTime, hmToMinutes, atMinutes, todayKey } from '../domain/dates'
import { cutoffsFor } from '../domain/sleepTimes'
import type { ActivityKey, Intensity, PlannedSession, Profile, ProtocolVersion, SessionLog } from '../domain/types'
import { displayToMeters, distanceUnit, fmt, metersToDisplay } from '../domain/units'
import { activityOf, countsAsHard, targetOf, useProfile, useProtocol } from '../hooks'
import { useUi } from '../store'
import { Button, cx, Field, IntensityPicker, Sheet, Stepper, Toggle } from '../ui/primitives'

const BUILTIN: ActivityKey[] = ['pickleball', 'strength', 'mtb', 'bike_commute']

export function LogSessionSheet({ planned, activity, edit }: { planned?: PlannedSession; activity?: ActivityKey; edit?: SessionLog }) {
  const profile = useProfile()
  const protocol = useProtocol()
  if (!profile || !protocol) return null
  return <Form planned={planned} activity={activity} edit={edit} profile={profile} protocol={protocol} />
}

function Form({
  planned,
  activity,
  edit,
  profile,
  protocol,
}: {
  planned?: PlannedSession
  activity?: ActivityKey
  edit?: SessionLog
  profile: Profile
  protocol: ProtocolVersion
}) {
  const close = useUi((s) => s.close)
  const toast = useUi((s) => s.showToast)

  const initialType: ActivityKey = edit?.activityType ?? planned?.activityType ?? activity ?? 'pickleball'
  const durationFor = (k: ActivityKey) => {
    if (k === 'bike_commute') return profile.commuteDefaultMin
    const t = targetOf(protocol, k)
    return t ? t.durationMin : 60
  }

  const [type, setType] = useState<ActivityKey>(initialType)
  const [date, setDate] = useState(edit?.date ?? planned?.date ?? todayKey())
  const [duration, setDuration] = useState(edit?.durationMin ?? durationFor(initialType))
  const defaultStart = () => {
    const d = new Date(Date.now() - duration * 60_000)
    return format(d, 'HH:mm')
  }
  const [start, setStart] = useState(edit ? format(edit.startAt, 'HH:mm') : defaultStart())
  const [intensity, setIntensity] = useState<Intensity>(edit?.intensity ?? activityOf(protocol, initialType)!.defaultIntensity)
  const [useRpe, setUseRpe] = useState(edit?.rpe != null)
  const [rpe, setRpe] = useState(edit?.rpe ?? 6)
  const [distance, setDistance] = useState(edit?.distanceM != null ? fmt(metersToDisplay(edit.distanceM, profile.units)) : '')
  const [note, setNote] = useState(edit?.note ?? '')

  const [adding, setAdding] = useState(false)
  const choices = [...BUILTIN, ...protocol.activityTypes.filter((a) => a.custom && !a.hidden).map((a) => a.key)]

  /** `defaultIntensity` is passed for an activity created a moment ago, before the live query has it. */
  const pickType = (k: ActivityKey, defaultIntensity?: Intensity) => {
    setType(k)
    if (!edit) {
      setDuration(durationFor(k))
      setIntensity(defaultIntensity ?? activityOf(protocol, k)?.defaultIntensity ?? 'moderate')
    }
  }

  const presets = useMemo(() => {
    const t = targetOf(protocol, type)
    if (type === 'bike_commute') return [10, 15, 20, 30, 45]
    if (!t) return [30, 60, 90, 120]
    const set = new Set([t.durationMin, Math.round((t.durationMin + t.durationMax) / 2 / 5) * 5, t.durationMax])
    return [...set]
  }, [protocol, type])

  const startAt = atMinutes(date, hmToMinutes(start))
  const endAt = startAt + duration * 60_000
  const isIntense = countsAsHard(activityOf(protocol, type), intensity)
  const cutoff = cutoffsFor(date, profile, protocol.sleepRules).exerciseCutoff
  // Distance for rides and for the user's own activities (a hike, a run).
  const isBike = type === 'bike_commute' || type === 'mtb' || type.startsWith('custom_')

  const save = async () => {
    const distanceM = isBike && distance.trim() !== '' && !Number.isNaN(Number(distance)) ? displayToMeters(Number(distance), profile.units) : undefined
    const fields = {
      date,
      activityType: type,
      startAt,
      durationMin: duration,
      intensity,
      rpe: useRpe ? rpe : undefined,
      distanceM,
      note: note.trim() || undefined,
    }
    if (edit) {
      await updateSession(edit.id, fields)
    } else {
      // Link to the matching planned session that day so it shows as done.
      let plannedSessionId = planned?.id
      if (!plannedSessionId || planned?.activityType !== type) {
        plannedSessionId = undefined
        const candidates = await db.plannedSessions.where('date').equals(date).toArray()
        const logs = await db.sessionLogs.where('date').equals(date).toArray()
        const open = candidates.find(
          (p) => !p.deletedAt && p.activityType === type && !logs.some((l) => !l.deletedAt && l.plannedSessionId === p.id),
        )
        plannedSessionId = open?.id
      }
      await logSession({ ...fields, plannedSessionId })
    }
    close()
    toast({ message: `${label} ${edit ? 'updated' : 'logged'}, ${formatDuration(duration)} ${intensity}` })
  }

  const remove = async () => {
    if (!edit) return
    await deleteSession(edit.id)
    close()
    toast({ message: `${label} deleted`, action: { label: 'Undo', run: () => void updateSession(edit.id, { deletedAt: undefined }) } })
  }

  const label = activityOf(protocol, type)?.label ?? 'Activity'

  const dayChoices = [
    { key: todayKey(), label: 'Today' },
    { key: addDaysKey(todayKey(), -1), label: 'Yesterday' },
  ]

  return (
    <Sheet title={edit ? 'Edit activity' : 'Log activity'}>
      {!planned && !edit && (
        <Field label="Activity">
          <div className="grid grid-cols-2 gap-2">
            {choices.map((k) => (
              <button
                key={k}
                onClick={() => pickType(k)}
                aria-pressed={type === k}
                className={cx('min-h-12 rounded-xl border px-3 text-left font-medium', type === k ? 'border-ink bg-ink text-bg' : 'border-line')}
              >
                {activityOf(protocol, k)?.label ?? (type === k ? label : '')}
              </button>
            ))}
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="min-h-12 rounded-xl border border-dashed border-ink-3 px-3 text-left font-medium text-ink-2"
              >
                New activity
              </button>
            )}
          </div>
          {adding && (
            <NewActivityForm
              existing={protocol.activityTypes.filter((a) => !a.hidden).map((a) => a.label.toLowerCase())}
              onCancel={() => setAdding(false)}
              onAdded={(key, defaultIntensity) => {
                setAdding(false)
                pickType(key, defaultIntensity)
              }}
            />
          )}
        </Field>
      )}

      <Field label="Duration">
        <Stepper label="duration" value={duration} step={5} min={5} max={600} onChange={setDuration} format={formatDuration} />
        <div className="mt-2 flex flex-wrap gap-2">
          {presets.map((m) => (
            <button
              key={m}
              onClick={() => setDuration(m)}
              className={cx('min-h-11 rounded-full border px-4 text-sm', duration === m ? 'border-ink font-semibold' : 'border-line text-ink-2')}
            >
              {formatDuration(m)}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Intensity" hint={type === 'strength' ? 'Strength counts toward total exercise, not cardio.' : 'Vigorous minutes count double toward cardio.'}>
        <IntensityPicker value={intensity} onChange={setIntensity} />
      </Field>

      <Field label="When">
        <div className="flex flex-wrap gap-2">
          {dayChoices.map((d) => (
            <button
              key={d.key}
              onClick={() => setDate(d.key)}
              className={cx('min-h-11 rounded-full border px-4 text-sm', date === d.key ? 'border-ink font-semibold' : 'border-line text-ink-2')}
            >
              {d.label}
            </button>
          ))}
          <input
            type="date"
            aria-label="Date"
            value={date}
            max={todayKey()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="min-h-11 rounded-full border border-line bg-surface px-3 text-sm"
          />
        </div>
        <label className="mt-3 flex items-center gap-3">
          <span className="text-sm text-ink-2">Started at</span>
          <input
            type="time"
            value={start}
            onChange={(e) => e.target.value && setStart(e.target.value)}
            className="num min-h-12 rounded-xl border border-line bg-surface px-3 text-lg"
          />
          <span className="text-sm text-ink-3">ends {formatTime(endAt)}</span>
        </label>
        {isIntense && endAt > cutoff && (
          <p className="mt-2 text-sm text-amber">Ends after your exercise cutoff ({formatTime(cutoff)}); it will be noted against that night's sleep.</p>
        )}
      </Field>

      {isBike && (
        <Field label={`Distance (${distanceUnit(profile.units)}), optional`}>
          <input
            inputMode="decimal"
            value={distance}
            onChange={(e) => setDistance(e.target.value.replace(',', '.'))}
            placeholder="—"
            className="num min-h-12 w-40 rounded-xl border border-line bg-surface px-3 text-lg"
          />
        </Field>
      )}

      <Field label="Effort (RPE 1–10), optional">
        {useRpe ? (
          <div className="flex items-center gap-3">
            <input type="range" min={1} max={10} value={rpe} onChange={(e) => setRpe(Number(e.target.value))} className="h-12 flex-1" aria-label="RPE" />
            <span className="num w-8 text-2xl font-semibold">{rpe}</span>
            <button className="min-h-11 px-2 text-sm text-ink-2" onClick={() => setUseRpe(false)}>
              Clear
            </button>
          </div>
        ) : (
          <button className="min-h-11 rounded-full border border-line px-4 text-sm text-ink-2" onClick={() => setUseRpe(true)}>
            Add effort
          </button>
        )}
      </Field>

      <Field label="Note">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
          className="min-h-12 w-full rounded-xl border border-line bg-surface px-3"
        />
      </Field>

      <div className="flex gap-2 pb-2">
        {edit && (
          <Button variant="danger" onClick={remove}>
            Delete
          </Button>
        )}
        <Button onClick={save} className="flex-1">
          {edit ? 'Save changes' : `Log ${label.toLowerCase()}`}
        </Button>
      </div>
    </Sheet>
  )
}


function NewActivityForm({
  existing,
  onAdded,
  onCancel,
}: {
  existing: string[]
  onAdded: (key: ActivityKey, defaultIntensity: Intensity) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [intensity, setIntensity] = useState<Intensity>('moderate')
  const [cardio, setCardio] = useState(true)
  const clean = name.trim()
  const duplicate = existing.includes(clean.toLowerCase())

  const add = async () => {
    if (!clean || duplicate) return
    const key = await addCustomActivity({ label: clean, defaultIntensity: intensity, isCardio: cardio })
    onAdded(key, intensity)
  }

  return (
    <div className="mt-3 rounded-xl border border-line p-3">
      <label className="block text-sm font-medium text-ink-2" htmlFor="new-activity-name">
        Name
      </label>
      <input
        id="new-activity-name"
        autoFocus
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void add()}
        placeholder="Hike, swim, yoga…"
        className="mt-1 mb-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3"
      />
      <p className={cx('mb-3 text-sm', duplicate ? 'text-amber' : 'text-ink-3')}>
        {duplicate ? 'You already have an activity with that name.' : 'It stays in this list for next time.'}
      </p>
      <div className="mb-1 text-sm font-medium text-ink-2">Usual intensity</div>
      <IntensityPicker value={intensity} onChange={setIntensity} />
      <div className="mt-2">
        <Toggle label="Counts toward the cardio goal" checked={cardio} onChange={setCardio} />
      </div>
      <div className="mt-2 flex gap-2">
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={add} disabled={!clean || duplicate}>
          Add activity
        </Button>
      </div>
    </div>
  )
}
