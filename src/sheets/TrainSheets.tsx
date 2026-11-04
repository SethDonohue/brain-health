import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addPlanned, alive, removePlanned, resetPlanned, skipPlanned, startStrength } from '../db/repo'
import { fromDateKey, weekStartOf } from '../domain/dates'
import { plannedStatus } from '../domain/plan'
import { historyFor, targetLabel } from '../domain/strength'
import type { ActivityKey, PlannedSession } from '../domain/types'
import { fmtWeight, weightUnit } from '../domain/units'
import { activityOf, targetOf, useProfile, useProtocol } from '../hooks'
import { useUi } from '../store'
import { Button, Sheet } from '../ui/primitives'

/** Tap a session in the planner: log it, move it, skip it or remove it. */
export function PlannedSheet({ planned }: { planned: PlannedSession }) {
  const protocol = useProtocol()
  const logs = useLiveQuery(async () => alive(await db.sessionLogs.where('plannedSessionId').equals(planned.id).toArray()), [planned.id])
  const { close, open, showToast: toast, setPlayer } = useUi()
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
      {target?.note && <p className="mb-4 text-ink-2">{target.note}</p>}
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
    </Sheet>
  )
}

/** Plan an extra session on a day (origin 'added'). */
export function AddSessionSheet({ date }: { date: string }) {
  const protocol = useProtocol()
  const { close, showToast: toast } = useUi()
  if (!protocol) return null
  const choices = protocol.activityTypes.filter((a) => a.key !== 'rest' && a.key !== 'bike_commute' && !a.hidden)
  const add = async (key: ActivityKey, label: string) => {
    await addPlanned(weekStartOf(date), date, key, targetOf(protocol, key)?.slot ?? 'am')
    close()
    toast({ message: `${label} planned for ${format(fromDateKey(date), 'EEEE')}` })
  }
  return (
    <Sheet title={`Plan on ${format(fromDateKey(date), 'EEEE')}`}>
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
