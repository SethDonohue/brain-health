import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../db/db'
import { activeStrength, alive, deleteSession, finishStrength, saveSet, unsaveSet } from '../db/repo'
import { formatDuration } from '../domain/dates'
import { historyFor, prefill, targetLabel, type SetPlan } from '../domain/strength'
import type { Exercise, Intensity, Profile, ProtocolVersion, SessionLog, SetLog } from '../domain/types'
import { displayToKg, fmtWeight, weightStep, weightUnit } from '../domain/units'
import { useProfile, useProtocol } from '../hooks'
import { useUi } from '../store'
import { Button, cx, Field, IntensityPicker, Segmented, Stepper } from '../ui/primitives'

interface Plan {
  variant: string
  sets: SetPlan[]
}

export function StrengthPlayer() {
  const profile = useProfile()
  const protocol = useProtocol()
  const session = useLiveQuery(async () => (await activeStrength()) ?? null, [])
  const setPlayer = useUi((s) => s.setPlayer)

  // The session was finished or discarded elsewhere: close.
  useEffect(() => {
    if (session === null) setPlayer(false)
  }, [session, setPlayer])

  if (!profile || !protocol || !session) return null
  return <Player key={session.id} session={session} profile={profile} protocol={protocol} />
}

function useTick(ms: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function Player({ session, profile, protocol }: { session: SessionLog; profile: Profile; protocol: ProtocolVersion }) {
  const setPlayer = useUi((s) => s.setPlayer)
  const exercises = protocol.workout.exercises
  const now = useTick(500)
  const [idx, setIdx] = useState(0)
  const [restEnds, setRestEnds] = useState<number | null>(null)
  const [plans, setPlans] = useState<Record<string, Plan> | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const data = useLiveQuery(async () => {
    const [allSets, sessions] = await Promise.all([db.setLogs.toArray(), db.sessionLogs.where('activityType').equals('strength').toArray()])
    return { allSets: alive(allSets) as SetLog[], sessions: alive(sessions) }
  }, [])
  const saved = useMemo(() => data?.allSets.filter((s) => s.sessionId === session.id) ?? [], [data, session.id])

  // Build each exercise's plan once: resume what's saved in this session, otherwise prefill from history.
  useEffect(() => {
    if (!data || plans) return
    const out: Record<string, Plan> = {}
    for (const ex of exercises) {
      const mine = saved.filter((s) => s.exerciseKey === ex.key)
      const variant = mine[0]?.variant ?? lastVariant(ex, data.allSets, data.sessions) ?? ex.variants[0].key
      const v = ex.variants.find((x) => x.key === variant) ?? ex.variants[0]
      const pre = prefill(ex, v, historyFor(ex.key, v.key, data.allSets, data.sessions), profile.units)
      const sets = pre.sets.map((p, i) => {
        const s = mine.find((m) => m.setIndex === i)
        return s ? { weightKg: s.weightKg, reps: s.reps, holdSec: s.holdSec } : p
      })
      out[ex.key] = { variant: v.key, sets }
    }
    setPlans(out)
  }, [data, plans, saved, exercises, profile.units])

  // Buzz when the rest is over.
  const restLeft = restEnds ? restEnds - now : 0
  useEffect(() => {
    if (restEnds && restLeft <= 0) {
      navigator.vibrate?.([200, 100, 200])
      setRestEnds(null)
    }
  }, [restEnds, restLeft])

  useEffect(() => {
    scroller.current?.scrollTo(0, 0)
  }, [idx])

  if (!data || !plans) return <Shell onHide={() => setPlayer(false)} elapsed={now - session.startAt} target={protocol.workout.sessionTargetMin} />

  const onSummary = idx >= exercises.length
  const ex = exercises[Math.min(idx, exercises.length - 1)]
  const plan = plans[ex.key]
  const isSaved = (exKey: string, i: number) => saved.some((s) => s.exerciseKey === exKey && s.setIndex === i)
  const doneCount = (e: Exercise) => saved.filter((s) => s.exerciseKey === e.key).length

  const update = (exKey: string, next: Plan) => setPlans({ ...plans, [exKey]: next })

  const setValues = (i: number, values: SetPlan) => {
    const weightChanged = values.weightKg !== plan.sets[i].weightKg
    const sets = plan.sets.map((s, j) => {
      if (j === i) return values
      // A weight entered on one set carries down to later sets that are still blank or unticked.
      if (weightChanged && j > i && !isSaved(ex.key, j) && (s.weightKg == null || s.weightKg === plan.sets[i].weightKg)) return { ...s, weightKg: values.weightKg }
      return s
    })
    update(ex.key, { ...plan, sets })
    if (isSaved(ex.key, i)) void saveSet(session.id, ex.key, plan.variant, i, values)
  }

  const toggleSet = async (i: number) => {
    if (isSaved(ex.key, i)) {
      await unsaveSet(session.id, ex.key, i)
      return
    }
    await saveSet(session.id, ex.key, plan.variant, i, plan.sets[i])
    const lastOfAll = idx === exercises.length - 1 && plan.sets.every((_, j) => j === i || isSaved(ex.key, j))
    if (!lastOfAll) setRestEnds(Date.now() + profile.restTimerSec * 1000)
  }

  const switchVariant = (variant: string) => {
    const v = ex.variants.find((x) => x.key === variant)!
    const pre = prefill(ex, v, historyFor(ex.key, v.key, data.allSets, data.sessions), profile.units)
    update(ex.key, { variant, sets: pre.sets })
    // Sets already ticked move to the new variant with the fresh values.
    pre.sets.forEach((values, i) => {
      if (isSaved(ex.key, i)) void saveSet(session.id, ex.key, variant, i, values)
    })
  }

  return (
    <Shell onHide={() => setPlayer(false)} elapsed={now - session.startAt} target={protocol.workout.sessionTargetMin} onFinish={onSummary ? undefined : () => setIdx(exercises.length)}>
      <nav aria-label="Exercises" className="flex gap-1 px-4 pt-3">
        {exercises.map((e, i) => {
          const complete = doneCount(e) >= e.targetSets
          return (
            <button
              key={e.key}
              onClick={() => setIdx(i)}
              aria-label={`Exercise ${i + 1}, ${e.name}${complete ? ', done' : ''}`}
              aria-current={i === idx ? 'step' : undefined}
              className="flex min-h-11 flex-1 items-center"
            >
              <span className={cx('h-1.5 w-full rounded-full', i === idx ? 'bg-ink' : complete ? 'bg-moderate' : doneCount(e) > 0 ? 'bg-moderate-soft' : 'bg-line')} />
            </button>
          )
        })}
      </nav>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 pb-6">
        {onSummary ? (
          <Summary session={session} profile={profile} protocol={protocol} saved={saved} elapsed={now - session.startAt} onBack={() => setIdx(exercises.length - 1)} />
        ) : (
          <ExerciseView
            key={ex.key}
            ex={ex}
            index={idx}
            plan={plan}
            profile={profile}
            history={historyFor(ex.key, plan.variant, data.allSets, data.sessions)}
            isSaved={(i) => isSaved(ex.key, i)}
            onVariant={switchVariant}
            onValues={setValues}
            onToggle={(i) => void toggleSet(i)}
          />
        )}
      </div>

      {!onSummary && (
        <div className="border-t border-line bg-bg px-4 pt-3 pb-3">
          {restEnds ? (
            <div className="flex items-center gap-3" role="timer" aria-live="polite">
              <div className="flex-1">
                <div className="text-sm text-ink-2">Rest</div>
                <div className="num text-3xl font-semibold">{clock(restLeft)}</div>
              </div>
              <Button variant="outline" onClick={() => setRestEnds((r) => (r ?? Date.now()) + 15_000)}>
                +15 s
              </Button>
              <Button onClick={() => setRestEnds(null)}>Skip rest</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
                Previous
              </Button>
              <Button className="flex-1" onClick={() => setIdx(idx + 1)}>
                {idx === exercises.length - 1 ? 'Review and finish' : `Next: ${exercises[idx + 1].variants.find((v) => v.key === plans[exercises[idx + 1].key].variant)?.name}`}
              </Button>
            </div>
          )}
        </div>
      )}
    </Shell>
  )
}

function lastVariant(ex: Exercise, sets: SetLog[], sessions: SessionLog[]): string | undefined {
  const done = new Map(sessions.filter((s) => s.status === 'done').map((s) => [s.id, s.startAt]))
  const mine = sets.filter((s) => s.exerciseKey === ex.key && done.has(s.sessionId)).sort((a, b) => done.get(b.sessionId)! - done.get(a.sessionId)!)
  return mine[0]?.variant
}

function Shell({ children, onHide, onFinish, elapsed, target }: { children?: React.ReactNode; onHide: () => void; onFinish?: () => void; elapsed: number; target: [number, number] }) {
  const mins = elapsed / 60000
  const over = mins > target[1]
  return (
    <div className="fixed inset-0 z-40 mx-auto flex max-w-[480px] flex-col bg-bg pt-[var(--sat)] pb-[var(--sab)]" role="dialog" aria-modal="true" aria-label="Strength workout">
      <header className="flex items-center justify-between border-b border-line px-2 py-1">
        <button onClick={onHide} className="min-h-12 rounded-xl px-3 text-ink-2 active:bg-sunk">
          Hide
        </button>
        <div className="text-center">
          <div className={cx('num text-xl font-semibold', over && 'text-amber')}>{clock(elapsed)}</div>
          <div className="text-xs text-ink-3">
            aim for {target[0]}–{target[1]} min
          </div>
        </div>
        {onFinish ? (
          <button onClick={onFinish} className="min-h-12 rounded-xl px-3 font-medium text-moderate active:bg-sunk">
            Finish
          </button>
        ) : (
          <span className="w-16" />
        )}
      </header>
      {children}
    </div>
  )
}

function ExerciseView({
  ex,
  index,
  plan,
  profile,
  history,
  isSaved,
  onVariant,
  onValues,
  onToggle,
}: {
  ex: Exercise
  index: number
  plan: Plan
  profile: Profile
  history: ReturnType<typeof historyFor>
  isSaved: (i: number) => boolean
  onVariant: (v: string) => void
  onValues: (i: number, v: SetPlan) => void
  onToggle: (i: number) => void
}) {
  const v = ex.variants.find((x) => x.key === plan.variant) ?? ex.variants[0]
  const u = profile.units
  const last = history[0]
  const suggestion = useMemo(() => prefill(ex, v, history, u).suggestIncrease, [ex, v, history, u])
  const fmtSet = (s: SetLog) => (v.target.kind === 'hold' ? `${s.holdSec ?? 0} s` : v.weighted && s.weightKg != null ? `${fmtWeight(s.weightKg, u)}×${s.reps ?? 0}` : `${s.reps ?? 0}`)

  return (
    <div className="pt-3">
      <div className="text-sm text-ink-2">
        Exercise {index + 1}, {ex.name.toLowerCase()}
      </div>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{v.name}</h1>
      {ex.variants.length > 1 && (
        <div className="mt-3">
          <Segmented label="Variation" value={plan.variant} onChange={onVariant} options={ex.variants.map((x) => ({ value: x.key, label: x.name }))} />
        </div>
      )}

      <div className="mt-4 rounded-xl bg-moderate-soft px-4 py-3">
        <div className="text-sm font-semibold text-moderate">How to do it</div>
        <p className="mt-0.5">{ex.cue}</p>
      </div>

      <div className="mt-4 text-sm">
        <div className="font-medium">Target {targetLabel(ex, v)}</div>
        <div className="text-ink-2">
          {last ? (
            <>
              Last time {format(last.session.startAt, 'MMM d')}: <span className="num">{last.sets.map(fmtSet).join(', ')}</span>
              {v.weighted && ` ${weightUnit(u)}`}
            </>
          ) : v.weighted ? (
            'First time: pick a weight you can lift with good form.'
          ) : (
            'First time'
          )}
        </div>
      </div>
      {suggestion && (
        <p className="mt-3 rounded-xl bg-sunk px-4 py-3 text-sm">
          You hit the top of the range on every set last time, so this starts at {fmtWeight(suggestion.toKg, u)} {weightUnit(u)} (up from {fmtWeight(suggestion.fromKg, u)}).
        </p>
      )}

      <ol className="mt-4 space-y-2">
        {plan.sets.map((s, i) => {
          const done = isSaved(i)
          return (
            <li key={i} className={cx('flex items-center gap-2 rounded-2xl px-3 py-2', done ? 'bg-moderate-soft' : 'bg-surface')}>
              <span className="num w-10 shrink-0 text-sm text-ink-2">Set {i + 1}</span>
              <div className="flex min-w-0 flex-1 items-center justify-around gap-2">
                {v.weighted && <WeightInput kg={s.weightKg} baseKg={plan.sets[i - 1]?.weightKg} units={u} onChange={(weightKg) => onValues(i, { ...s, weightKg })} label={`Set ${i + 1} weight`} />}
                {v.target.kind === 'reps' ? (
                  <MiniStepper value={s.reps ?? 0} step={1} unit="reps" label={`Set ${i + 1} reps`} onChange={(reps) => onValues(i, { ...s, reps })} />
                ) : (
                  <MiniStepper value={s.holdSec ?? 0} step={5} unit="sec" label={`Set ${i + 1} hold`} onChange={(holdSec) => onValues(i, { ...s, holdSec })} />
                )}
              </div>
              <button
                onClick={() => onToggle(i)}
                role="checkbox"
                aria-checked={done}
                aria-label={`Set ${i + 1} ${done ? 'done' : 'not done'}`}
                className={cx('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2', done ? 'border-moderate bg-moderate text-surface' : 'border-ink-3 text-ink-3')}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
                  <path d="M4 10.5l4 4 8-9" />
                </svg>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-sm text-ink-3">Tick a set when it's done; the rest timer starts on its own.</p>
    </div>
  )
}

function MiniStepper({ value, step, unit, label, onChange }: { value: number; step: number; unit: string; label: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center" role="group" aria-label={label}>
      <button aria-label={`Less, ${label}`} onClick={() => onChange(Math.max(0, value - step))} className="h-11 w-9 rounded-lg text-xl text-ink-2 active:bg-sunk">
        −
      </button>
      <span className="w-12 text-center leading-tight">
        <span className="num block text-lg font-semibold">{value}</span>
        <span className="block text-[11px] text-ink-3">{unit}</span>
      </span>
      <button aria-label={`More, ${label}`} onClick={() => onChange(value + step)} className="h-11 w-9 rounded-lg text-xl text-ink-2 active:bg-sunk">
        +
      </button>
    </div>
  )
}

/** Weight shown in the user's unit, stored in kg; ± steps by 2.5 kg or 5 lb, and the number can be typed. */
function WeightInput({ kg, baseKg, units, label, onChange }: { kg?: number; baseKg?: number; units: Profile['units']; label: string; onChange: (kg: number | undefined) => void }) {
  const shown = kg != null ? fmtWeight(kg, units) : ''
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  const step = weightStep(units)
  const bump = (d: number) => {
    // A blank set steps from the set above it rather than from zero.
    const from = kg ?? baseKg
    const cur = from != null ? Number(fmtWeight(from, units)) : 0
    onChange(displayToKg(Math.max(0, cur + d), units))
  }
  const commit = () => {
    const n = Number(text.replace(',', '.'))
    if (text.trim() === '') onChange(undefined)
    else if (!Number.isNaN(n)) onChange(displayToKg(n, units))
    else setText(shown)
  }
  return (
    <div className="flex items-center" role="group" aria-label={label}>
      <button aria-label={`Lighter, ${label}`} onClick={() => bump(-step)} className="h-11 w-9 rounded-lg text-xl text-ink-2 active:bg-sunk">
        −
      </button>
      <span className="w-14 text-center leading-tight">
        <input
          inputMode="decimal"
          aria-label={label}
          value={text}
          placeholder="—"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="num w-full bg-transparent text-center text-lg font-semibold outline-none placeholder:text-ink-3"
        />
        <span className="block text-[11px] text-ink-3">{weightUnit(units)}</span>
      </span>
      <button aria-label={`Heavier, ${label}`} onClick={() => bump(step)} className="h-11 w-9 rounded-lg text-xl text-ink-2 active:bg-sunk">
        +
      </button>
    </div>
  )
}

function Summary({ session, profile, protocol, saved, elapsed, onBack }: { session: SessionLog; profile: Profile; protocol: ProtocolVersion; saved: SetLog[]; elapsed: number; onBack: () => void }) {
  const setPlayer = useUi((s) => s.setPlayer)
  const toast = useUi((s) => s.showToast)
  const [duration, setDuration] = useState(Math.max(5, Math.round(elapsed / 60000)))
  const [intensity, setIntensity] = useState<Intensity>('moderate')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const u = profile.units

  const save = async () => {
    await finishStrength(session.id, { durationMin: duration, intensity })
    setPlayer(false)
    toast({ message: `Strength saved: ${formatDuration(duration)}, ${saved.length} sets` })
  }
  const discard = async () => {
    await deleteSession(session.id)
    setPlayer(false)
    toast({ message: 'Workout discarded' })
  }

  return (
    <div className="pt-3">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Workout summary</h1>
      <p className="mt-1 text-ink-2">
        Started {format(session.startAt, 'h:mm a')}, {saved.length} sets done.
      </p>
      <ul className="mt-4 divide-y divide-line rounded-2xl bg-surface">
        {protocol.workout.exercises.map((ex) => {
          const sets = saved.filter((s) => s.exerciseKey === ex.key).sort((a, b) => a.setIndex - b.setIndex)
          const v = ex.variants.find((x) => x.key === sets[0]?.variant) ?? ex.variants[0]
          const top = Math.max(0, ...sets.map((s) => s.weightKg ?? 0))
          return (
            <li key={ex.key} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
              <span className={cx(sets.length === 0 && 'text-ink-3')}>{v.name}</span>
              <span className="num text-right text-sm text-ink-2">
                {sets.length === 0
                  ? 'Skipped'
                  : `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}${v.weighted && top > 0 ? `, top ${fmtWeight(top, u)} ${weightUnit(u)}` : v.target.kind === 'hold' ? `, best ${Math.max(...sets.map((s) => s.holdSec ?? 0))} s` : ''}`}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="mt-6">
        <Field label="Duration" hint="Adjust it if you forgot to finish on time.">
          <Stepper label="duration" value={duration} step={5} min={5} max={240} onChange={setDuration} format={formatDuration} />
        </Field>
        <Field label="Intensity">
          <IntensityPicker value={intensity} onChange={setIntensity} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" onClick={() => void save()}>
          Save workout
        </Button>
      </div>
      <Button variant="danger" className="mt-4 w-full" onClick={() => (confirmDiscard ? void discard() : setConfirmDiscard(true))}>
        {confirmDiscard ? 'Tap again to discard this workout' : 'Discard workout'}
      </Button>
    </div>
  )
}
