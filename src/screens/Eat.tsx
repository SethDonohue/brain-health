import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { addServing, alive, deleteServings, logMeal, undoLastServing, weekRange } from '../db/repo'
import { addDaysKey, fromDateKey, weekStartOf } from '../domain/dates'
import { groupProgress, periodWord, servingStep, targetText, type GroupProgress } from '../domain/mind'
import type { DietGroup, MealTemplate, Profile, ProtocolVersion } from '../domain/types'
import { fmt } from '../domain/units'
import { useProfile, useProtocol, useToday } from '../hooks'
import { useUi } from '../store'
import { cx, Segmented } from '../ui/primitives'
import { useLongPress } from '../ui/useLongPress'

export function Eat() {
  const today = useToday()
  const profile = useProfile()
  const protocol = useProtocol()
  const [day, setDay] = useState<'today' | 'yesterday'>('today')
  const date = day === 'today' ? today : addDaysKey(today, -1)
  const ws = weekStartOf(date)

  const logs = useLiveQuery(async () => {
    const [from, to] = weekRange(ws)
    return alive(await db.servingLogs.where('date').between(from, to, true, true).toArray())
  }, [ws])

  if (!profile || !protocol || !logs) return null
  const groups = protocol.dietGroups.filter((g) => !g.optional || (g.key === 'wine' && profile.wineEnabled))
  const dayLogs = logs.filter((l) => l.date === date)
  const progress = groups.map((g) => groupProgress(g, dayLogs, logs))
  const dos = progress.filter((p) => p.group.kind === 'do')
  const limits = progress.filter((p) => p.group.kind === 'limit')
  const met = dos.filter((p) => p.status === 'met').length

  return (
    <div>
      <header className="flex items-end justify-between px-4 pt-4">
        <div>
          <div className="text-sm text-ink-2">{format(fromDateKey(date), 'EEEE, MMMM d')}</div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Eat</h1>
        </div>
        <div className="w-48">
          <Segmented
            label="Day"
            value={day}
            onChange={setDay}
            options={[
              { value: 'yesterday', label: 'Yesterday' },
              { value: 'today', label: 'Today' },
            ]}
          />
        </div>
      </header>

      <section aria-label="Aim for" className="mt-5 px-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-medium">Aim for</h2>
          <span className="text-sm text-ink-2">
            {met} of {dos.length} on track
          </span>
        </div>
        <ul className="grid grid-cols-2 gap-2">
          {dos.map((p) => (
            <DoTile key={p.group.key} p={p} date={date} />
          ))}
        </ul>
        <p className="mt-2 text-sm text-ink-3">Tap to add a serving. Press and hold to take one back.</p>
      </section>

      <section aria-label="Keep under" className="mt-6 px-4">
        <h2 className="mb-2 font-medium">Keep under</h2>
        <ul className="divide-y divide-line rounded-2xl bg-surface">
          {limits.map((p) => (
            <LimitRow key={p.group.key} p={p} date={date} />
          ))}
        </ul>
      </section>

      <Meals protocol={protocol} profile={profile} date={date} />
    </div>
  )
}

function useServingActions(group: DietGroup, date: string) {
  const toast = useUi((s) => s.showToast)
  const step = servingStep(group)
  const unit = group.unit === 'tbsp' ? ' tbsp' : ''
  return {
    add: async () => {
      const id = await addServing(date, group.key, step)
      toast({ message: `${group.label} +${fmt(step)}${unit}`, action: { label: 'Undo', run: () => void deleteServings([id]) } })
    },
    undo: async () => {
      const ok = await undoLastServing(date, group.key)
      toast({ message: ok ? `${group.label}: took one back` : `Nothing to take back for ${group.label.toLowerCase()}` })
    },
  }
}

function Ring({ fraction, tone, children }: { fraction: number; tone: string; children: React.ReactNode }) {
  const r = 20
  const c = 2 * Math.PI * r
  return (
    <span className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      <svg width="48" height="48" viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--sunk)" strokeWidth="5" />
        {fraction > 0 && (
          <circle cx="24" cy="24" r={r} fill="none" stroke={tone} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * fraction} ${c}`} />
        )}
      </svg>
      <span className="num relative text-sm font-semibold">{children}</span>
    </span>
  )
}

function DoTile({ p, date }: { p: GroupProgress; date: string }) {
  const { add, undo } = useServingActions(p.group, date)
  const press = useLongPress(add, undo)
  const tone = p.status === 'over' ? 'var(--amber)' : 'var(--moderate)'
  const sub =
    p.status === 'met'
      ? p.group.period === 'day'
        ? 'Done for today'
        : 'Done for the week'
      : p.status === 'over'
        ? `Over ${targetText(p.group)}`
        : `${fmt(p.value)} of ${targetText(p.group)}`
  return (
    <li>
      <button
        {...press}
        aria-label={`${p.group.label}: ${fmt(p.value)} ${periodWord(p.group)}, target ${targetText(p.group)}. Tap to add a serving, hold to take one back.`}
        className={cx(
          'flex min-h-[88px] w-full touch-manipulation select-none items-center gap-3 rounded-2xl bg-surface p-3 text-left [-webkit-touch-callout:none] active:bg-sunk',
          p.status === 'met' && 'ring-1 ring-moderate',
        )}
      >
        <Ring fraction={p.fraction} tone={tone}>
          {fmt(p.value)}
        </Ring>
        <span className="min-w-0">
          <span className="block font-medium leading-tight">{p.group.label}</span>
          <span className={cx('block text-xs', p.status === 'met' ? 'text-moderate' : p.status === 'over' ? 'text-amber' : 'text-ink-2')}>{sub}</span>
          <span className="mt-0.5 block text-xs leading-tight text-ink-3">{p.group.servingHint}</span>
        </span>
      </button>
    </li>
  )
}

function LimitRow({ p, date }: { p: GroupProgress; date: string }) {
  const { add, undo } = useServingActions(p.group, date)
  const press = useLongPress(add, undo)
  const color = p.status === 'cap' ? 'var(--red)' : p.status === 'near' ? 'var(--amber)' : 'var(--ink-3)'
  const note = p.status === 'cap' ? 'Cap reached' : p.status === 'near' ? 'Close to the cap' : `${fmt(Math.max(0, p.target - p.value))} left ${periodWord(p.group)}`
  return (
    <li>
      <button
        {...press}
        aria-label={`${p.group.label}: ${fmt(p.value)} ${periodWord(p.group)}, keep ${targetText(p.group)}. ${note}. Tap to add, hold to take one back.`}
        className="flex min-h-16 w-full touch-manipulation select-none flex-col justify-center px-4 py-2 text-left [-webkit-touch-callout:none] active:bg-sunk"
      >
        <span className="flex w-full items-baseline justify-between">
          <span className="font-medium">{p.group.label}</span>
          <span className="num text-sm">
            <span className="font-semibold" style={{ color: p.status === 'ok' ? undefined : color }}>
              {fmt(p.value)}
            </span>
            <span className="text-ink-2"> / {targetText(p.group)}</span>
          </span>
        </span>
        <span className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunk">
          <span className="block h-full rounded-full" style={{ width: `${p.fraction * 100}%`, background: color }} />
        </span>
        <span className="mt-1 flex w-full justify-between text-xs">
          <span className="text-ink-3">{p.group.servingHint}</span>
          <span style={{ color: p.status === 'ok' ? 'var(--ink-3)' : color }}>{note}</span>
        </span>
      </button>
    </li>
  )
}

function Meals({ protocol, profile, date }: { protocol: ProtocolVersion; profile: Profile; date: string }) {
  const toast = useUi((s) => s.showToast)
  const label = (k: string) => protocol.dietGroups.find((g) => g.key === k)?.label.toLowerCase() ?? k
  const enabled = (k: string) => k !== 'wine' || profile.wineEnabled
  const log = async (m: MealTemplate) => {
    const ids = await logMeal(date, m, enabled)
    toast({ message: `${m.label} added, ${ids.length} servings`, action: { label: 'Undo', run: () => void deleteServings(ids) } })
  }
  return (
    <section aria-label="Usual meals" className="mt-6 px-4">
      <h2 className="mb-2 font-medium">Usual meals</h2>
      <ul className="space-y-2">
        {protocol.mealTemplates.map((m) => (
          <li key={m.key}>
            <button onClick={() => void log(m)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 text-left active:bg-sunk">
              <span className="min-w-0">
                <span className="block font-medium">{m.label}</span>
                <span className="block text-sm text-ink-2">{m.servings.filter((s) => enabled(s.dietGroupKey)).map((s) => label(s.dietGroupKey)).join(', ')}</span>
              </span>
              <span className="shrink-0 text-sm font-medium text-moderate">Add</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

