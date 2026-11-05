import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { addServing, alive, deleteServings, logMeal, undoLastServing, weekRange } from '../db/repo'
import { addDaysKey, fromDateKey, weekStartOf } from '../domain/dates'
import { bandText, bandZones, groupProgress, MIND_BANDS, periodWord, servingStep, targetText, trackMax, type GroupProgress, type Points } from '../domain/mind'
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
  const open = useUi((s) => s.open)
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
  // Days of this week up to the shown day: daily groups' study band uses the average over these days.
  const daysSoFar = Math.max(1, Math.round((fromDateKey(date).getTime() - fromDateKey(ws).getTime()) / 864e5) + 1)
  const progress = groups.map((g) => groupProgress(g, dayLogs, logs))
  const dos = progress.filter((p) => p.group.kind === 'do')
  const limits = progress.filter((p) => p.group.kind === 'limit')
  const met = dos.filter((p) => p.status === 'met').length

  return (
    <div>
      <header className="px-4 pt-4">
        <div className="text-sm text-ink-2">{format(fromDateKey(date), 'EEEE, MMMM d')}</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Eat</h1>
        {/* Own row, so a long date or a large text size never collides with the toggle. */}
        <div className="mt-3">
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

      <Legend onAbout={() => open({ kind: 'mindAbout' })} onEdit={() => open({ kind: 'editTargets' })} />

      <section aria-label="Aim for" className="mt-4 px-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-medium">Aim for</h2>
          <span className="text-sm text-ink-2">
            {met} of {dos.length} at your target
          </span>
        </div>
        <ul className="divide-y divide-line rounded-2xl bg-surface">
          {dos.map((p) => (
            <GroupRow key={p.group.key} p={p} date={date} daysSoFar={daysSoFar} />
          ))}
        </ul>
        <p className="mt-2 text-sm text-ink-3">Tap a food to add a serving. Press and hold to take one back.</p>
      </section>

      <section aria-label="Keep under" className="mt-6 px-4">
        <h2 className="mb-2 font-medium">Keep under</h2>
        <ul className="divide-y divide-line rounded-2xl bg-surface">
          {limits.map((p) => (
            <GroupRow key={p.group.key} p={p} date={date} daysSoFar={daysSoFar} />
          ))}
        </ul>
      </section>

      <Meals protocol={protocol} profile={profile} date={date} />
    </div>
  )
}

const ZONE_FILL: Record<Points, string> = { 0: 'var(--band-0)', 0.5: 'var(--band-half)', 1: 'var(--band-full)' }

function Legend({ onAbout, onEdit }: { onAbout: () => void; onEdit: () => void }) {
  return (
    <section aria-label="How to read the bars" className="mx-4 mt-4 rounded-2xl bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="font-medium text-ink">MIND study points</span>
        {([0, 0.5, 1] as Points[]).map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm" style={{ background: ZONE_FILL[p] }} />
            {p === 0.5 ? '½' : p}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <Marker small />
          you
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0 border-l-2 border-dashed border-ink" />
          your target
        </span>
      </div>
      <div className="mt-1 flex gap-4">
        <button onClick={onAbout} className="min-h-11 text-sm font-medium text-moderate">
          About these bands
        </button>
        <button onClick={onEdit} className="min-h-11 text-sm font-medium text-moderate">
          Edit my targets
        </button>
      </div>
    </section>
  )
}

function Marker({ small }: { small?: boolean }) {
  const w = small ? 8 : 10
  return (
    <svg width={w} height={w * 0.8} viewBox="0 0 10 8" aria-hidden="true">
      <path d="M0 0h10L5 8z" fill="var(--ink)" />
    </svg>
  )
}

/** Study zones along a track, a triangle where the user is and a dashed tick at their own target. */
function BandTrack({ group, value, target }: { group: DietGroup; value: number; target: number }) {
  const band = MIND_BANDS[group.key]
  if (!band) return null
  const step = servingStep(group)
  const max = trackMax(band, target, value, step)
  const pct = (v: number) => `${(Math.min(v, max) / max) * 100}%`
  return (
    <div className="relative mt-3 mb-1 h-5" aria-hidden="true">
      <div className="absolute inset-x-0 bottom-0 flex h-2 gap-[2px] overflow-hidden rounded-full">
        {bandZones(band, max, step).map((z) => (
          <span key={z.from} className="h-full" style={{ width: `${((z.to - z.from) / max) * 100}%`, background: ZONE_FILL[z.points] }} />
        ))}
      </div>
      <span className="absolute bottom-0 h-4 -translate-x-1/2 border-l-2 border-dashed border-ink" style={{ left: pct(target) }} />
      <span className="absolute top-0 -translate-x-1/2" style={{ left: pct(value) }}>
        <Marker />
      </span>
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

function GroupRow({ p, date, daysSoFar }: { p: GroupProgress; date: string; daysSoFar: number }) {
  const { add, undo } = useServingActions(p.group, date)
  const press = useLongPress(add, undo)
  const g = p.group
  const band = MIND_BANDS[g.key]
  // The study counts daily groups as a weekly average; show that alongside today's count.
  const bandValue = band?.basis === 'day' ? p.week / daysSoFar : p.value
  const limit = g.kind === 'limit'
  const tone =
    p.status === 'cap' ? 'text-red' : p.status === 'near' || p.status === 'over' ? 'text-amber' : p.status === 'met' ? 'text-moderate' : 'text-ink-2'
  const statusWord =
    p.status === 'met' ? 'At target' : p.status === 'over' ? 'Over' : p.status === 'cap' ? 'Cap reached' : p.status === 'near' ? 'Close to cap' : undefined
  const studyLine = band
    ? `Study ${bandText(band, g.unit)}${band.basis === 'day' ? `; you average ${fmt(bandValue)} this week` : ''}`
    : g.key === 'wine'
      ? 'No study band for wine'
      : undefined

  return (
    <li>
      <button
        {...press}
        aria-label={`${g.label}: ${fmt(p.value)} ${periodWord(g)}, your target ${targetText(g)}${statusWord ? `, ${statusWord.toLowerCase()}` : ''}${studyLine ? `. ${studyLine}` : ''}. Tap to add a serving, hold to take one back.`}
        className="block w-full touch-manipulation select-none px-4 py-3 text-left [-webkit-touch-callout:none] active:bg-sunk"
      >
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="min-w-0 font-medium">{g.label}</span>
          <span className="num min-w-0 text-sm">
            <span className={cx('font-semibold', tone === 'text-ink-2' ? 'text-ink' : tone)}>{fmt(p.value)}</span>
            <span className="text-ink-2">
              {' '}
              {limit ? '/ ' : 'of '}
              {/* daily groups: the number is today's, so say so */}
              {g.period === 'day' ? `${targetText(g).replace(' a day', '')} today` : targetText(g)}
            </span>
            {statusWord && <span className={cx('ml-2 text-xs font-medium', tone)}>{statusWord}</span>}
          </span>
        </span>
        <BandTrack group={g} value={bandValue} target={g.target} />
        <span className="mt-1 flex justify-between gap-3 text-xs text-ink-3">
          <span className="min-w-0">{g.servingHint}</span>
          {studyLine && <span className="max-w-[58%] text-right">{studyLine}</span>}
        </span>
      </button>
    </li>
  )
}

function Meals({ protocol, profile, date }: { protocol: ProtocolVersion; profile: Profile; date: string }) {
  const toast = useUi((s) => s.showToast)
  const open = useUi((s) => s.open)
  const label = (k: string) => protocol.dietGroups.find((g) => g.key === k)?.label.toLowerCase() ?? k
  const enabled = (k: string) => k !== 'wine' || profile.wineEnabled
  const log = async (m: MealTemplate) => {
    const ids = await logMeal(date, m, enabled)
    toast({ message: `${m.label} added, ${ids.length} servings`, action: { label: 'Undo', run: () => void deleteServings(ids) } })
  }
  return (
    <section aria-label="Usual meals" className="mt-6 px-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-medium">Usual meals</h2>
        <button onClick={() => open({ kind: 'editMeals' })} className="min-h-11 text-sm font-medium text-moderate">
          Edit meals
        </button>
      </div>
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
      <p className="mt-2 text-sm text-ink-3">
        Have a recipe?{' '}
        <button onClick={() => open({ kind: 'import', mode: 'meal' })} className="min-h-11 font-medium text-moderate">
          Import it from a photo, file or text
        </button>
        , or share it to Brain Health from another app.
      </p>
    </section>
  )
}
