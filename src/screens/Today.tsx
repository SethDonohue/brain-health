import { format } from 'date-fns'
import { weekTotals, type WeekTotals } from '../domain/cardio'
import { addDaysKey, formatDuration, formatTime, fromDateKey } from '../domain/dates'
import { checkRestDay, intenseOnRestDay, plannedStatus, targetProgress } from '../domain/plan'
import { cutoffsFor } from '../domain/sleepTimes'
import type { PlannedSession, Profile, ProtocolVersion, SessionLog } from '../domain/types'
import { db } from '../db/db'
import { logSession, resetPlanned, skipPlanned, updateSession } from '../db/repo'
import { activityOf, useNow, useProfile, useProtocol, useToday, useWeek, type WeekData } from '../hooks'
import { useUi } from '../store'
import { Button, cx, intensityColor } from '../ui/primitives'

export function Today() {
  const today = useToday()
  const profile = useProfile()
  const protocol = useProtocol()
  const week = useWeek(today)
  const open = useUi((s) => s.open)
  if (!profile || !protocol || !week) return null

  const totals = weekTotals(week.logs, protocol.activityTypes)
  const last = weekTotals(week.lastWeekLogs, protocol.activityTypes)

  return (
    <div>
      <header className="flex items-start justify-between px-4 pt-4">
        <div>
          <div className="text-sm text-ink-2">{format(fromDateKey(today), 'EEEE')}</div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{format(fromDateKey(today), 'MMMM d')}</h1>
        </div>
        <button
          onClick={() => open({ kind: 'settings' })}
          className="flex min-h-12 min-w-12 items-center justify-center rounded-xl text-ink-2 active:bg-sunk"
          aria-label="Settings"
        >
          <GearIcon />
        </button>
      </header>

      <section aria-label="This week" className="mt-5 px-4">
        <CardioTrack totals={totals} last={last} profile={profile} />
        <ExerciseTotal totals={totals} last={last} week={week} protocol={protocol} />
      </section>

      <Cutoffs today={today} profile={profile} protocol={protocol} />

      <TodayPlan today={today} week={week} protocol={protocol} profile={profile} />
    </div>
  )
}

function CardioTrack({ totals, last, profile }: { totals: WeekTotals; last: WeekTotals; profile: Profile }) {
  const eq = totals.cardioModerateEqMin
  const { cardioFloorMin: floor, cardioTargetMin: target } = profile
  const scale = Math.max(target * 1.15, eq, last.cardioModerateEqMin) || 1
  const pct = (v: number) => `${(v / scale) * 100}%`
  const status = eq >= target ? 'Target met' : eq >= floor ? `${target - eq} to target` : `${floor - eq} to the floor`
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">Cardio this week</h2>
        <span className="text-sm text-ink-2">{status}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="num text-5xl font-semibold leading-none">{eq}</span>
        <span className="text-ink-2">of {target} min</span>
      </div>

      <div
        className="relative mt-6 mb-7 h-5 rounded-full bg-sunk"
        role="img"
        aria-label={`${eq} of ${target} minutes; floor ${floor}; last week ${last.cardioModerateEqMin}`}
      >
        <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full" style={{ width: pct(eq) }}>
          <div className="h-full bg-moderate" style={{ width: `${eq ? (totals.moderateMin / eq) * 100 : 0}%` }} />
          <div className="h-full bg-vigorous" style={{ width: `${eq ? ((totals.vigorousMin * 2) / eq) * 100 : 0}%` }} />
        </div>
        {[
          { v: floor, label: `Floor ${floor}` },
          { v: target, label: `Target ${target}` },
        ].map((t) => (
          <div key={t.label} className="absolute -top-2 -bottom-2 w-0.5 bg-ink" style={{ left: pct(t.v) }}>
            <span className="absolute top-full mt-1 -translate-x-1/2 whitespace-nowrap text-xs text-ink-2">{t.label}</span>
          </div>
        ))}
        {last.cardioModerateEqMin > 0 && (
          <div
            className="absolute -top-3 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[8px] border-x-transparent border-t-ink-3"
            style={{ left: pct(last.cardioModerateEqMin) }}
            title="Last week"
          />
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <Legend color="var(--moderate)" label="Moderate" value={`${totals.moderateMin} min`} />
        <Legend color="var(--vigorous)" label="Vigorous ×2" value={`${totals.vigorousMin} min`} />
        <Legend color="var(--ink-3)" label="Last week" value={`${last.cardioModerateEqMin}`} marker />
      </div>
      <p className="mt-3 text-xs text-ink-3">Moderate-equivalent minutes: vigorous counts double, light doesn't count.</p>
    </div>
  )
}

function Legend({ color, label, value, marker }: { color: string; label: string; value: string; marker?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-ink-2">
        {marker ? (
          <span className="h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent" style={{ borderTopColor: color }} />
        ) : (
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        )}
        {label}
      </div>
      <div className="num text-base font-semibold">{value}</div>
    </div>
  )
}

function ExerciseTotal({ totals, last, week, protocol }: { totals: WeekTotals; last: WeekTotals; week: WeekData; protocol: ProtocolVersion }) {
  const progress = targetProgress(protocol.weeklyTargets, week.planned, week.logs)
  const commutes = totals.sessionsByType.bike_commute ?? 0
  const own = protocol.activityTypes.filter((a) => a.custom && (totals.sessionsByType[a.key] ?? 0) > 0)
  return (
    <div className="mt-3 rounded-2xl bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">Total exercise</h2>
        <span className="text-sm text-ink-2">Last week {formatDuration(last.totalExerciseMin)}</span>
      </div>
      <div className="num mt-1 text-4xl font-semibold leading-none">{formatDuration(totals.totalExerciseMin)}</div>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {progress.map((p) => (
          <li key={p.activityType} className="flex items-center justify-between">
            <span className="text-ink-2">{activityOf(protocol, p.activityType)?.label}</span>
            <span className={cx('num font-semibold', p.done >= p.target && 'text-moderate')}>
              {p.done}/{p.target}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between">
          <span className="text-ink-2">Commute legs</span>
          <span className="num font-semibold">{commutes}</span>
        </li>
        {own.map((a) => (
          <li key={a.key} className="flex items-center justify-between">
            <span className="truncate text-ink-2">{a.label}</span>
            <span className="num font-semibold">{totals.sessionsByType[a.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Cutoffs({ today, profile, protocol }: { today: string; profile: Profile; protocol: ProtocolVersion }) {
  const now = useNow()
  const c = cutoffsFor(today, profile, protocol.sleepRules)
  const items = [
    { label: 'Last caffeine', at: c.caffeineCutoff },
    { label: 'Hard exercise done by', at: c.exerciseCutoff },
    { label: 'Warm shower', at: c.shower },
  ]
  return (
    <section aria-label="Today's cutoffs" className="mt-6 px-4">
      <h2 className="mb-2 font-medium">
        Tonight <span className="font-normal text-ink-2">bed at {formatTime(c.bedtime)}</span>
      </h2>
      <ul className="divide-y divide-line rounded-2xl bg-surface">
        {items.map((it) => {
          const left = it.at - now
          const passed = left <= 0
          return (
            <li key={it.label} className="flex min-h-14 items-center justify-between px-4">
              <span className={cx(passed && 'text-ink-3')}>{it.label}</span>
              <span className="text-right">
                <span className={cx('num text-lg font-semibold', passed && 'text-ink-3')}>{formatTime(it.at)}</span>
                <span className="block text-xs text-ink-2">{passed ? 'Passed' : `in ${formatDuration(Math.ceil(left / 60000))}`}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function TodayPlan({ today, week, protocol, profile }: { today: string; week: WeekData; protocol: ProtocolVersion; profile: Profile }) {
  const open = useUi((s) => s.open)
  const toast = useUi((s) => s.showToast)
  const planned = week.planned.filter((p) => p.date === today)
  const unplanned = week.logs.filter((l) => l.date === today && !l.plannedSessionId && l.status === 'done')
  const tomorrow = addDaysKey(today, 1)
  const tomorrowPlan = week.planned.filter((p) => p.date === tomorrow)
  const rest = checkRestDay(week.weekStart, week.planned, protocol.activityTypes)
  const restLogged = intenseOnRestDay(rest.restDate, week.logs, protocol.activityTypes)
  const restIsToday = planned.some((p) => p.activityType === 'rest')
  const late = cutoffsFor(today, profile, protocol.sleepRules).exerciseCutoff

  return (
    <section aria-label="Today's plan" className="mt-6 px-4">
      <h2 className="mb-2 font-medium">Today</h2>

      {(restLogged || (!rest.restDate && rest.candidates.length === 0)) && (
        <p className="mb-3 rounded-xl bg-amber-soft px-4 py-3 text-sm">
          {restLogged
            ? 'Hard activity was logged on your rest day. A full rest day helps recovery.'
            : 'This week has no rest day. Moving one session would free a day.'}
        </p>
      )}

      <ul className="space-y-2">
        {planned.length === 0 && unplanned.length === 0 && (
          <li className="rounded-2xl bg-surface px-4 py-4 text-ink-2">Nothing planned today. Anything you log still counts.</li>
        )}
        {planned.map((p) => (
          <PlannedRow
            key={p.id}
            p={p}
            logs={week.logs}
            protocol={protocol}
            lateAt={late}
            onDone={() => open({ kind: 'log', planned: p })}
            onSkip={async () => {
              await skipPlanned(p)
              toast({ message: `${activityOf(protocol, p.activityType)?.label} skipped`, action: { label: 'Undo', run: () => void resetPlanned(p.id) } })
            }}
            onMove={() => open({ kind: 'move', planned: p })}
            onUndo={() => void resetPlanned(p.id)}
          />
        ))}
        {unplanned.map((l) => (
          <LoggedRow key={l.id} log={l} protocol={protocol} onEdit={() => open({ kind: 'log', edit: l })} />
        ))}
      </ul>

      {!restIsToday && tomorrowPlan.length > 0 && (
        <p className="mt-4 text-sm text-ink-2">
          Tomorrow: {tomorrowPlan.map((p) => activityOf(protocol, p.activityType)?.label).join(', ')}
        </p>
      )}
    </section>
  )
}

function PlannedRow({
  p,
  logs,
  protocol,
  lateAt,
  onDone,
  onSkip,
  onMove,
  onUndo,
}: {
  p: PlannedSession
  logs: SessionLog[]
  protocol: ProtocolVersion
  lateAt: number
  onDone: () => void
  onSkip: () => void
  onMove: () => void
  onUndo: () => void
}) {
  const open = useUi((s) => s.open)
  const a = activityOf(protocol, p.activityType)
  const target = protocol.weeklyTargets.find((t) => t.activityType === p.activityType)
  const status = plannedStatus(p, logs)
  const doneLog = logs.find((l) => l.plannedSessionId === p.id && l.status === 'done')
  const slot = p.slot === 'am' ? 'Morning or midday' : 'Late afternoon'

  if (p.activityType === 'rest') {
    return (
      <li className="rounded-2xl bg-surface px-4 py-4">
        <div className="font-medium">Rest day</div>
        <div className="text-sm text-ink-2">{target?.note}</div>
        <button onClick={onMove} className="mt-2 min-h-11 text-sm font-medium text-moderate">
          Move rest day
        </button>
      </li>
    )
  }

  return (
    <li className="rounded-2xl bg-surface px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{a?.label}</div>
          <div className="text-sm text-ink-2">
            {slot}
            {target && target.durationMax > 0 && `, ${formatDuration(target.durationMin)}–${formatDuration(target.durationMax)}`}
          </div>
          {p.movedFromDate && <div className="text-xs text-ink-3">Moved from {format(fromDateKey(p.movedFromDate), 'EEEE')}</div>}
        </div>
        {status !== 'planned' && (
          <span className={cx('rounded-full px-3 py-1 text-sm font-medium', status === 'done' ? 'bg-moderate-soft text-moderate' : 'bg-sunk text-ink-2')}>
            {status === 'done' ? 'Done' : 'Skipped'}
          </span>
        )}
      </div>
      {status === 'planned' && <p className="mt-2 text-sm text-ink-2">{target?.note}</p>}
      {status === 'planned' && a?.isIntense && Date.now() < lateAt && (
        <p className="mt-1 text-sm text-ink-3">Finish by {formatTime(lateAt)} to protect sleep.</p>
      )}

      {status === 'done' && doneLog ? (
        <div className="mt-2 flex items-center justify-between">
          <LogSummary log={doneLog} />
          <button className="min-h-11 px-2 text-sm font-medium text-ink-2" onClick={() => open({ kind: 'log', edit: doneLog })}>
            Edit
          </button>
        </div>
      ) : status === 'skipped' ? (
        <button className="mt-2 min-h-11 text-sm font-medium text-ink-2" onClick={onUndo}>
          Undo skip
        </button>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button onClick={onDone} className="flex-1">
            {p.activityType === 'strength' ? 'Log workout' : 'Done'}
          </Button>
          <Button variant="outline" onClick={onMove}>
            Move
          </Button>
          <Button variant="quiet" onClick={onSkip}>
            Skip
          </Button>
        </div>
      )}
    </li>
  )
}

function LoggedRow({ log, protocol, onEdit }: { log: SessionLog; protocol: ProtocolVersion; onEdit: () => void }) {
  return (
    <li className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
      <div>
        <div className="font-medium">{activityOf(protocol, log.activityType)?.label}</div>
        <LogSummary log={log} />
      </div>
      <button className="min-h-11 px-2 text-sm font-medium text-ink-2" onClick={onEdit}>
        Edit
      </button>
    </li>
  )
}

function LogSummary({ log }: { log: SessionLog }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: intensityColor(log.intensity) }} />
      <span>
        {formatDuration(log.durationMin)}, {log.intensity}
      </span>
      <span className="text-ink-3">{formatTime(log.startAt)}</span>
    </div>
  )
}

/** Quick-log row docked in the footer above the tabs on the Today screen. */
export function QuickLogBar() {
  const today = useToday()
  const profile = useProfile()
  const week = useWeek(today)
  if (!profile || !week) return null
  return <QuickLogButtons profile={profile} today={today} week={week} />
}

function QuickLogButtons({ profile, today, week }: { profile: Profile; today: string; week: WeekData }) {
  const open = useUi((s) => s.open)
  const toast = useUi((s) => s.showToast)
  const legsToday = week.logs.filter((l) => l.date === today && l.activityType === 'bike_commute' && l.status === 'done').length

  const logCommute = async () => {
    const mins = profile.commuteDefaultMin
    const id = await logSession({
      date: today,
      activityType: 'bike_commute',
      startAt: Date.now() - mins * 60_000,
      durationMin: mins,
      intensity: 'moderate',
    })
    toast({
      message: `Commute leg logged, ${mins} min moderate`,
      secondary: { label: 'Hard ride', run: () => void updateSession(id, { intensity: 'vigorous' }) },
      action: {
        label: 'Edit',
        run: async () => {
          const l = await db.sessionLogs.get(id)
          if (l) open({ kind: 'log', edit: l })
        },
      },
    })
  }

  return (
    <div className="px-3 pt-2 pb-1">
      <div className="flex gap-2">
        <Button variant="outline" onClick={logCommute} className="flex-1 leading-tight">
          <span className="block">Commute leg</span>
          <span className="block text-xs font-normal text-ink-2">
            {profile.commuteDefaultMin} min{legsToday > 0 ? `, ${legsToday} today` : ''}
          </span>
        </Button>
        <Button onClick={() => open({ kind: 'log' })} className="flex-1">
          Log activity
        </Button>
      </div>
    </div>
  )
}

function GearIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  )
}

