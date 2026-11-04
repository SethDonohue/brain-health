import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { backupName, buildBackup, sessionsCsv, shareFile } from '../db/backup'
import { db } from '../db/db'
import { alive } from '../db/repo'
import { addDaysKey, formatDuration, fromDateKey, weekStartOf } from '../domain/dates'
import { QUALITY_LABELS } from '../domain/sleep'
import type { Profile, ProtocolVersion } from '../domain/types'
import { lateNightComparison, suggestions, summarizeWeek, weekStartsBack, type WeekInput, type WeekSummary } from '../domain/weekly'
import { activityOf, useProfile, useProtocol, useToday } from '../hooks'
import { useUi } from '../store'
import { Button, cx, Segmented } from '../ui/primitives'

const TREND_MAX = 12

export function Week() {
  const today = useToday()
  const profile = useProfile()
  const protocol = useProtocol()
  const thisWeek = weekStartOf(today)
  const [selected, setSelected] = useState(thisWeek)
  const [span, setSpan] = useState<4 | 12>(4)
  // Load enough history for 12 trend weeks plus the 4-week look-back the suggestion rules use.
  const from = addDaysKey(thisWeek, -7 * (TREND_MAX + 4))
  const to = addDaysKey(thisWeek, 7)

  const data = useLiveQuery(async () => {
    const [sessions, planned, servings, sleepLogs, checklist, caffeine, dismissed] = await Promise.all([
      db.sessionLogs.where('date').between(from, to, true, true).toArray(),
      db.plannedSessions.where('date').between(from, to, true, true).toArray(),
      db.servingLogs.where('date').between(from, to, true, true).toArray(),
      db.sleepLogs.where('night').between(from, to, true, true).toArray(),
      db.checklistLogs.where('night').between(from, to, true, true).toArray(),
      db.caffeineLogs.where('date').between(from, to, true, true).toArray(),
      db.suggestions.toArray(),
    ])
    const input: WeekInput = {
      sessions: alive(sessions),
      planned: alive(planned),
      servings: alive(servings),
      sleepLogs: alive(sleepLogs),
      checklist: alive(checklist),
      caffeine: alive(caffeine),
    }
    return { input, dismissed: new Set(dismissed.map((d) => d.id)) }
  }, [from, to])

  if (!profile || !protocol || !data) return null
  const summary = (ws: string) => summarizeWeek(ws, data.input, profile, protocol)
  const current = summary(selected)
  const trendWeeks = weekStartsBack(thisWeek, span).reverse()
  const trend = trendWeeks.map(summary)
  const offset = Math.round((fromDateKey(thisWeek).getTime() - fromDateKey(selected).getTime()) / (7 * 864e5))
  const ideas =
    selected === thisWeek
      ? suggestions(current, weekStartsBack(addDaysKey(thisWeek, -7), 4).map(summary), data.input, profile, protocol).filter((s) => !data.dismissed.has(s.id))
      : []

  return (
    <div>
      <header className="px-4 pt-4">
        <div className="text-sm text-ink-2">
          {format(fromDateKey(selected), 'MMM d')} to {format(fromDateKey(addDaysKey(selected, 6)), 'MMM d')}
          {current.isCurrent && current.daysElapsed < 7 && `, ${current.daysElapsed} ${current.daysElapsed === 1 ? 'day' : 'days'} so far`}
        </div>
        <div className="flex items-center justify-between">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Week</h1>
          <div className="flex items-center">
            <button className="flex min-h-12 min-w-12 items-center justify-center rounded-xl text-ink-2 active:bg-sunk disabled:opacity-25" disabled={offset >= TREND_MAX + 3} onClick={() => setSelected(addDaysKey(selected, -7))} aria-label="Previous week">
              <Arrow left />
            </button>
            <button className="min-h-12 rounded-xl px-2 text-sm font-medium" onClick={() => setSelected(thisWeek)}>
              {offset === 0 ? 'This week' : offset === 1 ? 'Last week' : `${offset} weeks ago`}
            </button>
            <button className="flex min-h-12 min-w-12 items-center justify-center rounded-xl text-ink-2 active:bg-sunk disabled:opacity-25" disabled={offset <= 0} onClick={() => setSelected(addDaysKey(selected, 7))} aria-label="Next week">
              <Arrow />
            </button>
          </div>
        </div>
      </header>

      {ideas.length > 0 && (
        <section aria-label="Suggestions" className="mt-4 space-y-2 px-4">
          {ideas.map((s) => (
            <article key={s.id} className="rounded-2xl border border-line bg-surface px-4 py-3">
              <h2 className="font-medium">{s.title}</h2>
              <p className="mt-1 text-sm text-ink-2">{s.body}</p>
              <div className="mt-1 flex justify-end">
                <button className="min-h-11 px-2 text-sm font-medium text-moderate" onClick={() => void db.suggestions.put({ id: s.id, status: 'dismissed', at: Date.now() })}>
                  Dismiss
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      <Exercise w={current} profile={profile} protocol={protocol} />
      <Mind w={current} />
      <SleepCard w={current} />
      <Trends trend={trend} span={span} setSpan={setSpan} selected={selected} onSelect={setSelected} profile={profile} input={data.input} protocol={protocol} />
      <Export protocol={protocol} />
    </div>
  )
}

function Card({ title, aside, children, label }: { title: string; aside?: React.ReactNode; children: React.ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} className="mt-6 px-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-medium">{title}</h2>
        {aside && <span className="text-sm text-ink-2">{aside}</span>}
      </div>
      <div className="rounded-2xl bg-surface p-4">{children}</div>
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm text-ink-2">{label}</div>
      <div className="num text-2xl font-semibold leading-tight">{value}</div>
      {sub && <div className="text-xs text-ink-3">{sub}</div>}
    </div>
  )
}

function Exercise({ w, profile, protocol }: { w: WeekSummary; profile: Profile; protocol: ProtocolVersion }) {
  const eq = w.totals.cardioModerateEqMin
  const status = eq >= profile.cardioTargetMin ? 'Target met' : eq >= profile.cardioFloorMin ? 'Floor met' : `${profile.cardioFloorMin - eq} to the floor`
  return (
    <Card title="Exercise">
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Cardio minutes" value={<>{eq}<span className="text-base font-normal text-ink-3"> of {profile.cardioTargetMin}</span></>} sub={`${status}; vigorous counts double`} />
        <Stat label="Total exercise" value={formatDuration(w.totals.totalExerciseMin)} sub={`${w.totals.moderateMin} moderate, ${w.totals.vigorousMin} vigorous`} />
      </div>
      <ul className="mt-4 divide-y divide-line border-t border-line">
        {w.targets.map((t) => {
          const hit = t.done >= t.target
          return (
            <li key={t.activityType} className="flex min-h-11 items-center justify-between">
              <span>{activityOf(protocol, t.activityType)?.label}</span>
              <span className="num">
                <span className={cx('font-semibold', hit && 'text-moderate')}>{t.done}</span>
                <span className="text-ink-3"> of {t.target}</span>
                {hit && <span className="ml-2 text-sm text-moderate">Hit</span>}
              </span>
            </li>
          )
        })}
        <li className="flex min-h-11 items-center justify-between">
          <span>Rest day</span>
          <span className="text-sm text-ink-2">{w.restKept === undefined ? (w.isCurrent ? 'Still to come' : 'None planned') : w.restKept ? 'Kept' : 'Had hard activity'}</span>
        </li>
      </ul>
    </Card>
  )
}

function Pip({ points }: { points: 0 | 0.5 | 1 }) {
  return (
    <span aria-hidden="true" className="relative inline-block h-3 w-3 shrink-0 overflow-hidden rounded-full border-2 border-[var(--chart)]">
      {points > 0 && <span className="absolute inset-y-0 left-0 bg-[var(--chart)]" style={{ width: points === 1 ? '100%' : '50%' }} />}
    </span>
  )
}

function Mind({ w }: { w: WeekSummary }) {
  return (
    <Card title="MIND diet score" aside={w.isCurrent && w.mind.logged ? 'so far this week' : undefined}>
      {!w.mind.logged ? (
        <p className="text-sm text-ink-2">No food logged this week, so there's no score. Servings you tap in Eat build it up.</p>
      ) : (
      <>
      <div className="flex items-baseline gap-2">
        <span className="num text-5xl font-semibold leading-none">{w.mind.score}</span>
        <span className="text-ink-2">of {w.mind.max}</span>
      </div>
      <p className="mt-1 text-xs text-ink-3">One point per food group, half for partway, using the published MIND scoring{w.mind.max === 14 ? '; wine isn’t tracked, so it’s out of 14' : ''}.</p>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3">
        {w.mind.groups.map((g) => (
          <li key={g.key} className="flex min-h-11 items-start gap-2 text-sm" aria-label={`${g.label}: ${g.points} point${g.points === 1 ? '' : 's'}, ${g.detail}`}>
            <span className="pt-1">
              <Pip points={g.points} />
            </span>
            <span className="min-w-0">
              <span className="block leading-tight">{g.label}</span>
              <span className="num block text-xs text-ink-3">{g.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      </>
      )}
    </Card>
  )
}

function SleepCard({ w }: { w: WeekSummary }) {
  const s = w.sleep
  return (
    <Card title="Sleep and caffeine">
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Average sleep" value={s.avgMin != null ? formatDuration(s.avgMin) : '—'} sub={`${s.nightsLogged} of ${s.nightsCounted} nights logged`} />
        <Stat label="Average quality" value={s.avgQuality != null ? s.avgQuality : '—'} sub={s.avgQuality != null ? QUALITY_LABELS[Math.round(s.avgQuality) - 1] : 'No nights logged'} />
        <Stat label="Wind-down checklist" value={s.checklistPct != null ? `${s.checklistPct}%` : '—'} sub="of items ticked" />
        <Stat label="Caffeine" value={`${w.caffeine.avgMgPerDay} mg`} sub="a day on average" />
      </div>
      <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
        <li className="flex min-h-11 items-center justify-between">
          <span>Days with caffeine after the cutoff</span>
          <span className={cx('num font-semibold', s.lateCaffeineDays > 0 && 'text-amber')}>{s.lateCaffeineDays}</span>
        </li>
        <li className="flex min-h-11 items-center justify-between">
          <span>Hard exercise inside 4 h of bed</span>
          <span className={cx('num font-semibold', s.lateExerciseNights > 0 && 'text-amber')}>{s.lateExerciseNights}</span>
        </li>
      </ul>
    </Card>
  )
}

interface Bar {
  key: string
  label: string
  value: number | undefined
}

/** One series of weekly bars on one axis, with optional reference lines. Tap a bar to open that week. */
function BarChart({ title, bars, max, refs = [], selected, onSelect, fmtValue }: { title: string; bars: Bar[]; max: number; refs?: { value: number; label: string }[]; selected: string; onSelect: (k: string) => void; fmtValue: (v: number) => string }) {
  const W = 360
  const H = 132
  const top = 18
  const bottom = 20
  const plotH = H - top - bottom
  const gap = 2
  // Reference-line labels sit in a gutter on the right so they never overlap a bar.
  const gutter = refs.length ? 64 : 0
  const PW = W - gutter
  const slot = PW / bars.length
  const selIdx = bars.findIndex((b) => b.key === selected)
  const bw = Math.min(28, slot - gap * 2 - (bars.length > 6 ? 4 : 16))
  const y = (v: number) => top + plotH - (Math.min(v, max) / max) * plotH
  const labelEvery = bars.length > 6 ? 3 : 1
  return (
    <figure className="mt-4">
      <figcaption className="mb-1 text-sm font-medium text-ink-2">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="group" aria-label={title}>
        <line x1={0} x2={PW} y1={top + plotH} y2={top + plotH} stroke="var(--line)" strokeWidth={1} />
        {refs.map((r) => (
          <g key={r.label}>
            <line x1={0} x2={PW} y1={y(r.value)} y2={y(r.value)} stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="3 3" />
            <text x={PW + 6} y={y(r.value) + 3.5} fontSize={10} fill="var(--ink-2)">
              {r.label}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx0 = slot * i + slot / 2
          const isSel = b.key === selected
          const v = b.value ?? 0
          const h = Math.max(b.value ? 2 : 0, top + plotH - y(v))
          const r = Math.min(4, bw / 2, h)
          const x = cx0 - bw / 2
          const yy = top + plotH - h
          return (
            <g key={b.key}>
              {h > 0 && (
                <path
                  d={`M${x},${top + plotH} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${top + plotH} Z`}
                  fill="var(--chart)"
                  opacity={isSel ? 1 : 0.55}
                />
              )}
              {isSel && (
                <text x={cx0} y={Math.min(yy, top + plotH) - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
                  {b.value != null ? fmtValue(b.value) : '—'}
                </text>
              )}
              {(isSel || (i % labelEvery === (bars.length - 1) % labelEvery && (selIdx < 0 || Math.abs(i - selIdx) >= labelEvery))) && (
                <text x={cx0} y={H - 5} textAnchor="middle" fontSize={10} fill={isSel ? 'var(--ink)' : 'var(--ink-3)'} fontWeight={isSel ? 600 : 400}>
                  {b.label}
                </text>
              )}
              {/* Hit target taller and wider than the bar */}
              <rect
                x={slot * i}
                y={0}
                width={slot}
                height={H}
                fill="transparent"
                role="button"
                tabIndex={0}
                aria-label={`Week of ${b.label}: ${b.value != null ? fmtValue(b.value) : 'no data'}`}
                aria-pressed={isSel}
                onClick={() => onSelect(b.key)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(b.key)}
                style={{ cursor: 'pointer' }}
              />
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

function Trends({ trend, span, setSpan, selected, onSelect, profile, input, protocol }: { trend: WeekSummary[]; span: 4 | 12; setSpan: (s: 4 | 12) => void; selected: string; onSelect: (k: string) => void; profile: Profile; input: WeekInput; protocol: ProtocolVersion }) {
  const label = (ws: string) => format(fromDateKey(ws), 'MMM d')
  const cardioMax = Math.max(profile.cardioTargetMin * 1.15, ...trend.map((w) => w.totals.cardioModerateEqMin))
  const cmp = lateNightComparison(input, profile, protocol)
  return (
    <section aria-label="Trends" className="mt-6 px-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-medium">Trends</h2>
        <div className="w-44">
          <Segmented
            label="Trend length"
            value={String(span) as '4' | '12'}
            onChange={(v) => setSpan(Number(v) as 4 | 12)}
            options={[
              { value: '4', label: '4 weeks' },
              { value: '12', label: '12 weeks' },
            ]}
          />
        </div>
      </div>
      <div className="rounded-2xl bg-surface px-4 pt-1 pb-4">
        <BarChart
          title="Cardio, moderate-equivalent minutes"
          bars={trend.map((w) => ({ key: w.weekStart, label: label(w.weekStart), value: w.totals.cardioModerateEqMin }))}
          max={cardioMax}
          refs={[
            { value: profile.cardioFloorMin, label: `Floor ${profile.cardioFloorMin}` },
            { value: profile.cardioTargetMin, label: `Target ${profile.cardioTargetMin}` },
          ]}
          selected={selected}
          onSelect={onSelect}
          fmtValue={(v) => String(v)}
        />
        <BarChart
          title={`MIND diet score, out of ${trend[0]?.mind.max ?? 14}`}
          bars={trend.map((w) => ({ key: w.weekStart, label: label(w.weekStart), value: w.mind.logged ? w.mind.score : undefined }))}
          max={trend[0]?.mind.max ?? 14}
          selected={selected}
          onSelect={onSelect}
          fmtValue={(v) => String(v)}
        />
        <BarChart
          title="Average sleep quality, 1 to 5"
          bars={trend.map((w) => ({ key: w.weekStart, label: label(w.weekStart), value: w.sleep.avgQuality }))}
          max={5}
          selected={selected}
          onSelect={onSelect}
          fmtValue={(v) => String(v)}
        />
        <p className="mt-3 text-xs text-ink-3">Tap a bar to open that week.</p>
        {cmp.late.n >= 2 && cmp.other.n >= 2 && (
          <p className="mt-3 rounded-xl bg-sunk px-3 py-2 text-sm">
            Nights after late caffeine or late hard exercise averaged <span className="num font-semibold">{cmp.late.avg}</span> for quality ({cmp.late.n} nights), against <span className="num font-semibold">{cmp.other.avg}</span> on other nights ({cmp.other.n}).
          </p>
        )}
      </div>
    </section>
  )
}

function Export({ protocol }: { protocol: ProtocolVersion }) {
  const toast = useUi((s) => s.showToast)
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      // Closing the share sheet without choosing is not an error worth showing.
      const msg = e instanceof Error ? e.message : String(e)
      if (!/cancel/i.test(msg)) toast({ message: `Export failed: ${msg}` })
    }
  }
  return (
    <Card title="Your data">
      <p className="text-sm text-ink-2">Everything stays on this phone. Export a backup to keep a copy in Drive or Files; restore it from Settings.</p>
      <div className="mt-3 flex flex-col gap-2">
        <Button variant="outline" onClick={() => void run(async () => shareFile(backupName(), JSON.stringify(await buildBackup()), 'application/json'))}>
          Export full backup (JSON)
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void run(async () => {
              const all = alive(await db.sessionLogs.toArray())
              await shareFile(`brain-health-activity-${format(new Date(), 'yyyy-MM-dd')}.csv`, sessionsCsv(all, protocol.activityTypes), 'text/csv')
            })
          }
        >
          Export activity log (CSV)
        </Button>
      </div>
    </Card>
  )
}

function Arrow({ left }: { left?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={left ? 'M12.5 5l-5 5 5 5' : 'M7.5 5l5 5-5 5'} />
    </svg>
  )
}
