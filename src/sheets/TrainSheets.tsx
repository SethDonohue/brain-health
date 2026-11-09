import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { addPlanned, alive, removePlanned, resetPlanned, setPlannedTime, skipPlanned, startStrength } from '../db/repo'
import { formatDuration, formatTimeRange, fromDateKey, weekStartOf } from '../domain/dates'
import { plannedStatus } from '../domain/plan'
import { historyFor, targetLabel } from '../domain/strength'
import type { ActivityKey, PlannedSession } from '../domain/types'
import { fmtWeight, weightUnit } from '../domain/units'
import { activityOf, targetOf, useProfile, useProtocol } from '../hooks'
import { useUi } from '../store'
import { Button, Sheet } from '../ui/primitives'

const LENGTHS = [30, 45, 60, 90, 120, 150, 180]

/** Start time and an optional length, for a planned session. */
function TimeFields({ start, length, onStart, onLength }: { start: string; length?: number; onStart: (v: string) => void; onLength: (v?: number) => void }) {
  return (
    <>
      <label className="mb-1 block text-sm font-medium text-ink-2" htmlFor="plan-start">
        Start
      </label>
      <input
        id="plan-start"
        type="time"
        value={start}
        onChange={(e) => onStart(e.target.value)}
        className="mb-4 block min-h-12 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink"
      />
      <div className="mb-2 text-sm font-medium text-ink-2">Length (optional)</div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Length">
        {[undefined, ...LENGTHS].map((m) => (
          <button
            key={m ?? 0}
            onClick={() => onLength(m)}
            aria-pressed={length === m}
            className={`min-h-11 rounded-full border px-3 text-sm ${length === m ? 'border-ink bg-ink text-bg' : 'border-line text-ink-2'}`}
          >
            {m ? formatDuration(m) : 'Not set'}
          </button>
        ))}
      </div>
    </>
  )
}

/** Session types that never get a time (logged as they happen, or not a session). */
const untimed = (key: string) => key === 'bike_commute' || key === 'rest'

/** Tap a session in the planner: log it, set its time, move it, skip it or remove it. */
export function PlannedSheet({ planned: initial }: { planned: PlannedSession }) {
  const protocol = useProtocol()
  // live, so a time set here shows straight away and "Log as done" picks it up
  const planned = useLiveQuery(() => db.plannedSessions.get(initial.id), [initial.id]) ?? initial
  const logs = useLiveQuery(async () => alive(await db.sessionLogs.where('plannedSessionId').equals(planned.id).toArray()), [planned.id])
  const { close, open, showToast: toast, setPlayer } = useUi()
  const [editing, setEditing] = useState(false)
  const [start, setStart] = useState(initial.startTime ?? (initial.slot === 'am' ? '09:00' : '17:00'))
  const [length, setLength] = useState<number | undefined>(initial.durationMin)
  if (!protocol || !logs) return null
  const a = activityOf(protocol, planned.activityType)
  const label = a?.label ?? ''
  const status = plannedStatus(planned, logs)
  const done = logs.find((l) => l.status === 'done')
  const target = targetOf(protocol, planned.activityType)
  const day = format(fromDateKey(planned.date), 'EEEE')
  const then = (fn: () => void) => () => {
    close()
    fn()
  }

  return (
    <Sheet title={`${label}, ${day}`}>
      {(planned.note || planned.startTime) && (
        <p className="mb-2 font-medium">
          {planned.startTime ? formatTimeRange(planned.startTime, planned.durationMin) : ''}
          {planned.note ? `${planned.startTime ? ', ' : ''}${planned.note}` : ''}
        </p>
      )}
      {/* the protocol's "morning or midday" style note is noise once there's a booked time */}
      {target?.note && !planned.startTime && <p className="mb-4 text-ink-2">{target.note}</p>}
      {editing ? (
        <div className="pb-2">
          <TimeFields start={start} length={length} onStart={setStart} onLength={setLength} />
          <div className="flex flex-col gap-2">
            <Button
              disabled={!start}
              onClick={async () => {
                await setPlannedTime(planned.id, { startTime: start, durationMin: length })
                setEditing(false)
                toast({ message: `${label} set for ${formatTimeRange(start, length)}`, action: { label: 'Undo', run: () => void db.plannedSessions.put(planned) } })
              }}
            >
              Save time
            </Button>
            {planned.startTime && (
              <Button
                variant="outline"
                onClick={async () => {
                  await setPlannedTime(planned.id, null)
                  setEditing(false)
                  toast({ message: `Time cleared`, action: { label: 'Undo', run: () => void db.plannedSessions.put(planned) } })
                }}
              >
                Clear time
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
      <div className="flex flex-col gap-2 pb-2">
        {planned.activityType === 'rest' ? (
          <Button onClick={then(() => open({ kind: 'move', planned }))}>Move rest day</Button>
        ) : status === 'planned' ? (
          <>
            {planned.activityType === 'strength' && (
              <Button
                onClick={then(async () => {
                  await startStrength(planned.id)
                  setPlayer(true)
                })}
              >
                Start workout
              </Button>
            )}
            <Button variant={planned.activityType === 'strength' ? 'outline' : 'primary'} onClick={then(() => open({ kind: 'log', planned }))}>
              {planned.activityType === 'strength' ? 'Log without sets' : 'Log as done'}
            </Button>
            {!untimed(planned.activityType) && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                {planned.startTime ? 'Change time' : 'Set time'}
              </Button>
            )}
            <Button variant="outline" onClick={then(() => open({ kind: 'move', planned }))}>
              Move to another day
            </Button>
            <Button
              variant="outline"
              onClick={then(async () => {
                await skipPlanned(planned)
                toast({ message: `${label} skipped`, action: { label: 'Undo', run: () => void resetPlanned(planned.id) } })
              })}
            >
              Skip this one
            </Button>
          </>
        ) : status === 'done' && done ? (
          <>
            <p className="text-ink-2">
              Done: {done.durationMin} min, {done.intensity}.
            </p>
            <Button variant="outline" onClick={then(() => open({ kind: 'log', edit: done }))}>
              Edit log
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={then(() => void resetPlanned(planned.id))}>
            Undo skip
          </Button>
        )}
        {planned.activityType !== 'rest' && (
          <Button
            variant="danger"
            onClick={then(async () => {
              await removePlanned(planned.id)
              toast({ message: `${label} removed from ${day}`, action: { label: 'Undo', run: () => void db.plannedSessions.update(planned.id, { deletedAt: undefined }) } })
            })}
          >
            Remove from this week
          </Button>
        )}
      </div>
      )}
    </Sheet>
  )
}

/** Plan an extra session on a day (origin 'added'). */
export function AddSessionSheet({ date }: { date: string }) {
  const protocol = useProtocol()
  const { close, showToast: toast } = useUi()
  const [timed, setTimed] = useState(false)
  const [start, setStart] = useState('17:00')
  const [length, setLength] = useState<number | undefined>()
  if (!protocol) return null
  const choices = protocol.activityTypes.filter((a) => !untimed(a.key) && !a.hidden)
  const add = async (key: ActivityKey, label: string) => {
    const time = timed && start ? { startTime: start, durationMin: length } : undefined
    await addPlanned(weekStartOf(date), date, key, targetOf(protocol, key)?.slot ?? 'am', undefined, time)
    close()
    toast({ message: `${label} planned for ${format(fromDateKey(date), 'EEEE')}${time ? `, ${formatTimeRange(time.startTime, time.durationMin)}` : ''}` })
  }
  return (
    <Sheet title={`Plan on ${format(fromDateKey(date), 'EEEE')}`}>
      {timed ? (
        <TimeFields start={start} length={length} onStart={setStart} onLength={setLength} />
      ) : (
        <button onClick={() => setTimed(true)} className="mb-3 min-h-11 text-sm font-medium text-moderate">
          + Add a time (optional)
        </button>
      )}
      <div className="mb-2 text-sm font-medium text-ink-2">{timed ? 'Then pick the activity' : 'Pick the activity'}</div>
      <ul className="grid grid-cols-2 gap-2 pb-2">
        {choices.map((a) => (
          <li key={a.key}>
            <button onClick={() => void add(a.key, a.label)} className="min-h-14 w-full rounded-xl border border-line px-3 text-left font-medium active:bg-sunk">
              {a.label}
            </button>
          </li>
        ))}
      </ul>
      <p className="pb-2 text-sm text-ink-3">Bike commutes aren't planned; log them as they happen.</p>
    </Sheet>
  )
}

/** Past sessions per exercise variant. */
export function ExerciseHistorySheet({ exerciseKey }: { exerciseKey: string }) {
  const protocol = useProtocol()
  const profile = useProfile()
  const data = useLiveQuery(async () => {
    const [sets, sessions] = await Promise.all([db.setLogs.where('exerciseKey').equals(exerciseKey).toArray(), db.sessionLogs.where('activityType').equals('strength').toArray()])
    return { sets: alive(sets), sessions: alive(sessions) }
  }, [exerciseKey])
  const ex = protocol?.workout.exercises.find((e) => e.key === exerciseKey)
  if (!protocol || !profile || !data || !ex) return null
  const u = profile.units
  return (
    <Sheet title={ex.name}>
      <p className="mb-4 text-sm text-ink-2">{ex.cue}</p>
      {ex.variants.map((v) => {
        const h = historyFor(ex.key, v.key, data.sets, data.sessions)
        const best = v.weighted ? Math.max(0, ...h.flatMap((x) => x.sets.map((s) => s.weightKg ?? 0))) : 0
        return (
          <section key={v.key} className="mb-6">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-medium">{v.name}</h3>
              <span className="text-sm text-ink-2">
                {targetLabel(ex, v)}
                {best > 0 && `, best ${fmtWeight(best, u)} ${weightUnit(u)}`}
              </span>
            </div>
            {h.length === 0 ? (
              <p className="rounded-xl bg-sunk px-4 py-3 text-sm text-ink-2">No sessions yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {h.slice(0, 12).map(({ session, sets }) => (
                  <li key={session.id} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
                    <span className="text-sm text-ink-2">{format(session.startAt, 'EEE, MMM d')}</span>
                    <span className="num text-right text-sm">
                      {sets
                        .map((s) =>
                          v.target.kind === 'hold' ? `${s.holdSec ?? 0} s` : v.weighted && s.weightKg != null ? `${fmtWeight(s.weightKg, u)}×${s.reps ?? 0}` : `${s.reps ?? 0}`,
                        )
                        .join(', ')}
                      {v.weighted && <span className="text-ink-3"> {weightUnit(u)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </Sheet>
  )
}
