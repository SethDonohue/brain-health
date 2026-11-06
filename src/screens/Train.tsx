import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db } from '../db/db'
import { activeStrength, alive, repeatLastWeek, saveUsualWeek, startStrength, undoPlanChange } from '../db/repo'
import { weekTotals } from '../domain/cardio'
import { addDaysKey, formatClock, formatDuration, fromDateKey, weekDays } from '../domain/dates'
import { checkRestDay, plannedStatus, targetProgress } from '../domain/plan'
import { historyFor, targetLabel } from '../domain/strength'
import type { PlannedSession, Profile, ProtocolVersion, SessionLog, SetLog } from '../domain/types'
import { fmtWeight, weightUnit } from '../domain/units'
import { activityOf, useProfile, useProtocol, useToday, useWeek, type WeekData } from '../hooks'
import { moveWithRestCheck } from '../sheets/MoveSheet'
import { useUi } from '../store'
import { Button, cx } from '../ui/primitives'

export function Train() {
  const today = useToday()
  const profile = useProfile()
  const protocol = useProtocol()
  const [offset, setOffset] = useState(0)
  const anchor = addDaysKey(today, offset * 7)
  // Only this week and later are planned automatically; past weeks just show what was logged.
  const week = useWeek(anchor, offset >= 0)
  if (!profile || !protocol || !week) return null
  const days = weekDays(week.weekStart)

  return (
    <div>
      <header className="px-4 pt-4">
        <div className="text-sm text-ink-2">
          {format(fromDateKey(days[0]), 'MMM d')} to {format(fromDateKey(days[6]), 'MMM d')}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Train</h1>
          <div className="flex items-center">
            <button className="flex min-h-12 min-w-12 items-center justify-center rounded-xl text-ink-2 active:bg-sunk disabled:opacity-25" disabled={offset <= -8} onClick={() => setOffset(offset - 1)} aria-label="Previous week">
              <Arrow left />
            </button>
            <button className="min-h-12 rounded-xl px-2 text-sm font-medium" onClick={() => setOffset(0)} aria-label="Back to this week">
              {offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : `${Math.abs(offset)} weeks ${offset < 0 ? 'ago' : 'ahead'}`}
            </button>
            <button className="flex min-h-12 min-w-12 items-center justify-center rounded-xl text-ink-2 active:bg-sunk disabled:opacity-25" disabled={offset >= 1} onClick={() => setOffset(offset + 1)} aria-label="Next week">
              <Arrow />
            </button>
          </div>
        </div>
      </header>

      <ResumeCard />
      <Targets week={week} protocol={protocol} profile={profile} />
      <Planner week={week} protocol={protocol} today={today} editable={offset >= 0} />
      {offset >= 0 && <PlanTools weekStart={week.weekStart} hasUsual={!!profile.usualWeek?.length} />}
      <Strength protocol={protocol} profile={profile} week={week} today={today} />
    </div>
  )
}

export function ResumeCard() {
  const setPlayer = useUi((s) => s.setPlayer)
  const active = useLiveQuery(async () => (await activeStrength()) ?? null, [])
  if (!active) return null
  return (
    <section className="mt-4 px-4" aria-label="Workout in progress">
      <button onClick={() => setPlayer(true)} className="flex w-full items-center justify-between rounded-2xl bg-ink px-4 py-4 text-left text-bg">
        <span>
          <span className="block font-medium">Strength workout in progress</span>
          <span className="text-sm opacity-80">Started {format(active.startAt, 'h:mm a')}</span>
        </span>
        <span className="font-semibold">Resume</span>
      </button>
    </section>
  )
}

function Targets({ week, protocol, profile }: { week: WeekData; protocol: ProtocolVersion; profile: Profile }) {
  const progress = targetProgress(protocol.weeklyTargets, week.planned, week.logs)
  const totals = weekTotals(week.logs, protocol.activityTypes)
  const rest = week.planned.find((p) => p.activityType === 'rest')
  return (
    <section aria-label="Weekly targets" className="mt-4 px-4">
      <ul className="grid grid-cols-2 gap-2">
        {progress.map((p) => {
          const met = p.done >= p.target
          return (
            <li key={p.activityType} className="rounded-2xl bg-surface px-4 py-3">
              <div className="text-sm text-ink-2">{activityOf(protocol, p.activityType)?.label}</div>
              <div className="num text-2xl font-semibold">
                <span className={cx(met && 'text-moderate')}>{p.done}</span>
                <span className="text-base font-normal text-ink-3"> of {p.target}</span>
              </div>
              {p.planned !== p.target && <div className="text-xs text-ink-3">{p.planned} planned</div>}
            </li>
          )
        })}
        <li className="rounded-2xl bg-surface px-4 py-3">
          <div className="text-sm text-ink-2">Cardio</div>
          <div className="num text-2xl font-semibold">
            <span className={cx(totals.cardioModerateEqMin >= profile.cardioTargetMin && 'text-moderate')}>{totals.cardioModerateEqMin}</span>
            <span className="text-base font-normal text-ink-3"> of {profile.cardioTargetMin}</span>
          </div>
          <div className="text-xs text-ink-3">{rest ? `Rest day ${format(fromDateKey(rest.date), 'EEEE')}` : 'No rest day planned'}</div>
        </li>
      </ul>
    </section>
  )
}

interface Drag {
  planned: PlannedSession
  label: string
  x: number
  y: number
  over?: string
}

/** Week planner. Press and hold a session to drag it to another day (F1.2); tap it for actions. */
function Planner({ week, protocol, today, editable }: { week: WeekData; protocol: ProtocolVersion; today: string; editable: boolean }) {
  const open = useUi((s) => s.open)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const press = useRef<{ planned: PlannedSession; x: number; y: number; timer: number } | null>(null)
  const restCheck = checkRestDay(week.weekStart, week.planned, protocol.activityTypes)

  // Near the top or bottom edge while dragging, scroll the page so every day can be reached.
  useEffect(() => {
    if (!drag) return
    const id = window.setInterval(() => {
      const d = dragRef.current
      if (!d) return
      const footer = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--footer-h')) || 72
      const bottomEdge = window.innerHeight - footer - 48
      const dy = d.y > bottomEdge ? 10 : d.y < 120 ? -10 : 0
      if (!dy) return
      window.scrollBy(0, dy)
      const over = dayAt(d.x, d.y)
      if (over && over !== d.over) setDrag({ ...d, over })
    }, 16)
    return () => window.clearInterval(id)
  }, [!!drag]) // eslint-disable-line react-hooks/exhaustive-deps

  // While dragging, stop the page from scrolling under the finger.
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault()
    }
    document.addEventListener('touchmove', block, { passive: false })
    return () => document.removeEventListener('touchmove', block)
  }, [])

  const dayAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('[data-drop-date]') as HTMLElement | null)?.dataset.dropDate

  const onDown = (e: React.PointerEvent, p: PlannedSession) => {
    if (e.button !== 0) return
    const x = e.clientX
    const y = e.clientY
    const label = activityOf(protocol, p.activityType)?.label ?? ''
    const timer = window.setTimeout(() => {
      if (!editable) return
      navigator.vibrate?.(25)
      useUi.getState().clearToast()
      setDrag({ planned: p, label, x, y, over: p.date })
    }, 350)
    press.current = { planned: p, x, y, timer }

    const move = (ev: PointerEvent) => {
      const d = dragRef.current
      if (d) {
        setDrag({ ...d, x: ev.clientX, y: ev.clientY, over: dayAt(ev.clientX, ev.clientY) ?? d.over })
      } else if (press.current && Math.hypot(ev.clientX - press.current.x, ev.clientY - press.current.y) > 8) {
        window.clearTimeout(press.current.timer)
        press.current = null
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      const d = dragRef.current
      if (d) {
        setDrag(null)
        if (d.over && d.over !== d.planned.date) void moveWithRestCheck(d.planned, d.over, protocol.activityTypes, d.label)
      } else if (press.current) {
        window.clearTimeout(press.current.timer)
        const tapped = press.current.planned
        press.current = null
        open({ kind: 'planned', planned: tapped })
      }
    }
    const cancel = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      if (press.current) window.clearTimeout(press.current.timer)
      press.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  return (
    <section aria-label="Week plan" className="mt-6 px-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-medium">Plan</h2>
        {editable && <span className="text-sm text-ink-3">Hold a session to drag it</span>}
      </div>
      {editable && restCheck.conflict && (
        <p className="mb-2 rounded-xl bg-amber-soft px-4 py-3 text-sm">
          {restCheck.candidates.length ? 'Your rest day has activity on it. Drag the rest day to a free day.' : 'Every day has hard activity planned. Moving one session would free a rest day.'}
        </p>
      )}
      <ol className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
        {weekDays(week.weekStart).map((d) => {
          const planned = week.planned.filter((p) => p.date === d)
          const extra = week.logs.filter((l) => l.date === d && !l.plannedSessionId && l.status === 'done')
          const isToday = d === today
          const isOver = drag?.over === d && drag.planned.date !== d
          return (
            <li
              key={d}
              data-drop-date={d}
              className={cx('flex min-h-16 items-center gap-3 px-3 py-2 transition-colors', isOver && 'bg-moderate-soft', !!drag && !isOver && 'opacity-90')}
              aria-current={isToday ? 'date' : undefined}
            >
              <div className="w-11 shrink-0">
                <div className={cx('text-sm font-semibold', isToday && 'text-moderate')}>{format(fromDateKey(d), 'EEE')}</div>
                <div className="num text-xs text-ink-3">{format(fromDateKey(d), 'd')}</div>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {planned.map((p) => (
                  <PlanChip
                    key={p.id}
                    p={p}
                    protocol={protocol}
                    logs={week.logs}
                    lifted={drag?.planned.id === p.id}
                    onPointerDown={(e) => onDown(e, p)}
                  />
                ))}
                {extra.map((l) => (
                  <LoggedChip key={l.id} log={l} protocol={protocol} />
                ))}
                {planned.length === 0 && extra.length === 0 && <span className="py-2 text-sm text-ink-3">Free</span>}
              </div>
              {editable && (
                <button onClick={() => open({ kind: 'addSession', date: d })} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-3 active:bg-sunk" aria-label={`Add a session on ${format(fromDateKey(d), 'EEEE')}`}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M9 3v12M3 9h12" />
                  </svg>
                </button>
              )}
            </li>
          )
        })}
      </ol>
      {drag && (
        <div className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[130%] rounded-full bg-ink px-4 py-2 text-sm font-semibold text-bg shadow-lg" style={{ left: drag.x, top: drag.y }}>
          {drag.label}
          {drag.over && drag.over !== drag.planned.date ? ` to ${format(fromDateKey(drag.over), 'EEEE')}` : ''}
        </div>
      )}
    </section>
  )
}

function PlanChip({ p, protocol, logs, lifted, onPointerDown }: { p: PlannedSession; protocol: ProtocolVersion; logs: SessionLog[]; lifted: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  const status = plannedStatus(p, logs)
  const label = activityOf(protocol, p.activityType)?.label ?? p.activityType
  const rest = p.activityType === 'rest'
  return (
    <button
      onPointerDown={onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          useUi.getState().open({ kind: 'planned', planned: p })
        }
      }}
      aria-label={`${label}, ${status === 'planned' ? 'planned' : status}. Tap for options, hold to drag.`}
      className={cx(
        'min-h-11 touch-manipulation select-none rounded-full border px-3 text-sm font-medium [-webkit-touch-callout:none]',
        lifted && 'opacity-30',
        status === 'done' && 'border-moderate bg-moderate-soft text-moderate',
        status === 'skipped' && 'border-line text-ink-3 line-through',
        status === 'planned' && (rest ? 'border-dashed border-ink-3 text-ink-2' : 'border-ink-3'),
      )}
    >
      {label}
      {p.startTime && <span className="font-normal text-ink-2"> {formatClock(p.startTime)}</span>}
    </button>
  )
}

/** Import bookings, repeat last week, save the usual week. */
function PlanTools({ weekStart, hasUsual }: { weekStart: string; hasUsual: boolean }) {
  const open = useUi((s) => s.open)
  const toast = useUi((s) => s.showToast)
  const repeat = async () => {
    const change = await repeatLastWeek(weekStart)
    if (!change) return toast({ message: 'Last week has no plan to copy' })
    toast({ message: `Copied last week's plan, ${change.added.length} sessions`, action: { label: 'Undo', run: () => void undoPlanChange(change) } })
  }
  const saveUsual = async () => {
    const n = await saveUsualWeek(weekStart)
    toast({ message: `Saved as your usual week, ${n} sessions. New weeks start from it.` })
  }
  return (
    <section aria-label="Plan tools" className="mt-3 px-4">
      <div className="rounded-2xl bg-surface p-4">
        <div className="font-medium">Booked a court or class?</div>
        <p className="mt-1 text-sm text-ink-2">
          Take a screenshot of your bookings, tap Share and pick Brain Health. Or add it here from a screenshot, a file or pasted text. You'll check everything before it's added.
        </p>
        <Button onClick={() => open({ kind: 'import', mode: 'sessions' })} className="mt-3 w-full">
          Import bookings
        </Button>
        <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
          <Button variant="outline" onClick={() => void repeat()}>
            Repeat last week
          </Button>
          <Button variant="outline" onClick={() => void saveUsual()}>
            {hasUsual ? 'Update usual week' : 'Save as usual week'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          {hasUsual ? 'New weeks start from your usual week. Reset it in Settings.' : 'New weeks start from your protocol. Save a week you like as your usual week.'}
        </p>
      </div>
    </section>
  )
}

function LoggedChip({ log, protocol }: { log: SessionLog; protocol: ProtocolVersion }) {
  const open = useUi((s) => s.open)
  const label = activityOf(protocol, log.activityType)?.label ?? log.activityType
  return (
    <button onClick={() => open({ kind: 'log', edit: log })} className="min-h-11 rounded-full bg-sunk px-3 text-sm text-ink-2" aria-label={`${label}, logged ${log.durationMin} minutes. Edit`}>
      {label} {formatDuration(log.durationMin)}
    </button>
  )
}

function Strength({ protocol, profile, week, today }: { protocol: ProtocolVersion; profile: Profile; week: WeekData; today: string }) {
  const open = useUi((s) => s.open)
  const setPlayer = useUi((s) => s.setPlayer)
  const data = useLiveQuery(async () => {
    const [sets, sessions] = await Promise.all([db.setLogs.toArray(), db.sessionLogs.where('activityType').equals('strength').toArray()])
    return { sets: alive(sets) as SetLog[], sessions: alive(sessions) }
  }, [])
  const plannedToday = week.planned.find((p) => p.date === today && p.activityType === 'strength' && plannedStatus(p, week.logs) === 'planned')

  const start = async () => {
    await startStrength(plannedToday?.id)
    setPlayer(true)
  }

  return (
    <section aria-label="Strength" className="mt-6 px-4">
      <h2 className="mb-2 font-medium">Strength</h2>
      <div className="rounded-2xl bg-surface p-4">
        <p className="text-sm text-ink-2">
          {protocol.workout.exercises.length} exercises, {protocol.workout.sessionTargetMin[0]}–{protocol.workout.sessionTargetMin[1]} min. {plannedToday ? 'Planned for today.' : ''}
        </p>
        <Button className="mt-3 w-full" onClick={() => void start()}>
          Start strength workout
        </Button>
        <Button variant="outline" className="mt-2 w-full" onClick={() => open({ kind: 'import', mode: 'routine' })}>
          Import a workout
        </Button>
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {protocol.workout.exercises.map((ex) => {
            const lastAny = data
              ? ex.variants
                  .map((v) => ({ v, h: historyFor(ex.key, v.key, data.sets, data.sessions)[0] }))
                  .filter((x) => x.h)
                  .sort((a, b) => b.h!.session.startAt - a.h!.session.startAt)[0]
              : undefined
            return (
              <li key={ex.key}>
                <button onClick={() => open({ kind: 'exerciseHistory', exerciseKey: ex.key })} className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left">
                  <span className="min-w-0">
                    <span className="block font-medium">{ex.variants.map((v) => v.name).join(' or ')}</span>
                    <span className="block text-xs text-ink-3">{targetLabel(ex, ex.variants[0])}</span>
                  </span>
                  <span className="shrink-0 text-right text-sm text-ink-2">
                    {lastAny ? (
                      <>
                        <span className="block">{lastAny.v.weighted && lastAny.h!.sets[0]?.weightKg != null ? `${fmtWeight(Math.max(...lastAny.h!.sets.map((s) => s.weightKg ?? 0)), profile.units)} ${weightUnit(profile.units)}` : `${lastAny.h!.sets.length} sets`}</span>
                        <span className="block text-xs text-ink-3">{format(lastAny.h!.session.startAt, 'MMM d')}</span>
                      </>
                    ) : (
                      <span className="text-ink-3">No history</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function Arrow({ left }: { left?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={left ? 'M12.5 5l-5 5 5 5' : 'M7.5 5l5 5-5 5'} />
    </svg>
  )
}
