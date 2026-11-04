import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { alive, deleteCaffeine, logCaffeine, restoreCaffeine, saveSleepLog, setChecklistItem } from '../db/repo'
import { addDaysKey, formatDuration, formatTime, fromDateKey, toDateKey } from '../domain/dates'
import { currentNight, lastNight, nightFlags, nightTimes, QUALITY_LABELS } from '../domain/sleep'
import { bedtimeFor, cutoffsFor } from '../domain/sleepTimes'
import type { CaffeineLog, ChecklistLog, DrinkPreset, Profile, ProtocolVersion, SessionLog, SleepLog } from '../domain/types'
import { roomTempRange } from '../domain/units'
import { useNow, useProfile, useProtocol } from '../hooks'
import { useUi } from '../store'
import { cx } from '../ui/primitives'

const HISTORY_NIGHTS = 14

interface SleepData {
  sleepLogs: SleepLog[]
  checklist: ChecklistLog[]
  caffeine: CaffeineLog[]
  sessions: SessionLog[]
  drinks: DrinkPreset[]
}

export function Sleep() {
  const profile = useProfile()
  const protocol = useProtocol()
  const now = useNow()
  const tonight = currentNight(now)
  const from = addDaysKey(tonight, -(HISTORY_NIGHTS + 1))
  // The caffeine/session window runs one day past tonight so after-midnight drinks are included.
  const to = addDaysKey(tonight, 1)

  const data = useLiveQuery(async (): Promise<SleepData> => {
    const [sleepLogs, checklist, caffeine, sessions, drinks] = await Promise.all([
      db.sleepLogs.where('night').between(from, tonight, true, true).toArray(),
      db.checklistLogs.where('night').between(from, tonight, true, true).toArray(),
      db.caffeineLogs.where('date').between(from, to, true, true).toArray(),
      db.sessionLogs.where('date').between(from, to, true, true).toArray(),
      db.drinkPresets.orderBy('sort').toArray(),
    ])
    return { sleepLogs: alive(sleepLogs), checklist: alive(checklist), caffeine: alive(caffeine), sessions: alive(sessions), drinks }
  }, [from, tonight, to])

  if (!profile || !protocol || !data) return null

  return (
    <div>
      <Header profile={profile} tonight={tonight} />
      <MorningCard profile={profile} night={lastNight(now)} logs={data.sleepLogs} />
      <Checklist profile={profile} protocol={protocol} night={tonight} data={data} now={now} />
      <Caffeine profile={profile} protocol={protocol} night={tonight} data={data} now={now} />
      <History profile={profile} protocol={protocol} last={lastNight(now)} data={data} />
    </div>
  )
}

function Header({ profile, tonight }: { profile: Profile; tonight: string }) {
  const open = useUi((s) => s.open)
  const bed = bedtimeFor(tonight, profile)
  return (
    <header className="flex items-start justify-between px-4 pt-4">
      <div>
        <div className="text-sm text-ink-2">{format(fromDateKey(tonight), 'EEEE')} night</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Sleep</h1>
      </div>
      <button onClick={() => open({ kind: 'bedtime' })} className="min-h-12 rounded-xl px-3 py-1 text-right active:bg-sunk" aria-label={`Bedtime ${bed}. Change bedtime`}>
        <span className="block text-sm text-ink-2">Bedtime</span>
        <span className="num block text-xl font-semibold">{formatTime(nightTimes(tonight, bed, profile.wakeDefault).bedAt)}</span>
      </button>
    </header>
  )
}

/** One-tap morning log: a quality tap saves the night with the target times; details can follow. */
function MorningCard({ profile, night, logs }: { profile: Profile; night: string; logs: SleepLog[] }) {
  const open = useUi((s) => s.open)
  const toast = useUi((s) => s.showToast)
  const log = logs.find((l) => l.night === night)

  if (log) {
    return (
      <section aria-label="Last night" className="mt-5 px-4">
        <button onClick={() => open({ kind: 'sleepLog', night })} className="flex w-full items-center justify-between rounded-2xl bg-surface px-4 py-4 text-left active:bg-sunk">
          <span>
            <span className="block font-medium">Last night</span>
            <span className="text-sm text-ink-2">
              {formatTime(log.bedAt)} to {formatTime(log.wakeAt)}
            </span>
          </span>
          <span className="text-right">
            <span className="num block text-2xl font-semibold">{formatDuration(Math.round((log.wakeAt - log.bedAt) / 60000))}</span>
            <span className="text-sm text-ink-2">{QUALITY_LABELS[log.quality - 1]}</span>
          </span>
        </button>
      </section>
    )
  }

  const quick = async (q: SleepLog['quality']) => {
    const t = nightTimes(night, bedtimeFor(night, profile), profile.wakeDefault)
    await saveSleepLog({ night, ...t, quality: q })
    toast({
      message: `Saved: ${formatTime(t.bedAt)} to ${formatTime(t.wakeAt)}, ${QUALITY_LABELS[q - 1].toLowerCase()}`,
      action: { label: 'Edit times', run: () => open({ kind: 'sleepLog', night }) },
    })
  }

  return (
    <section aria-label="How did you sleep" className="mt-5 px-4">
      <div className="rounded-2xl bg-surface p-4">
        <h2 className="font-medium">How did you sleep last night?</h2>
        <p className="mb-3 text-sm text-ink-2">Tap one to save it with your usual times.</p>
        <QualityPicker onPick={quick} />
        <button onClick={() => open({ kind: 'sleepLog', night })} className="mt-2 min-h-11 text-sm font-medium text-moderate">
          Enter bed and wake times
        </button>
      </div>
    </section>
  )
}

export function QualityPicker({ value, onPick }: { value?: number; onPick: (q: SleepLog['quality']) => void }) {
  return (
    <div role="radiogroup" aria-label="Sleep quality" className="grid grid-cols-5 gap-1.5">
      {QUALITY_LABELS.map((label, i) => {
        const q = (i + 1) as SleepLog['quality']
        const on = value === q
        return (
          <button
            key={label}
            role="radio"
            aria-checked={on}
            onClick={() => onPick(q)}
            className={cx('flex min-h-16 flex-col items-center justify-center rounded-xl border', on ? 'border-ink bg-ink text-bg' : 'border-line active:bg-sunk')}
          >
            <span className="num text-xl font-semibold">{q}</span>
            <span className={cx('text-xs', on ? 'text-bg' : 'text-ink-2')}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

function Checklist({ profile, protocol, night, data, now }: { profile: Profile; protocol: ProtocolVersion; night: string; data: SleepData; now: number }) {
  const c = cutoffsFor(night, profile, protocol.sleepRules)
  const checked = new Set(data.checklist.filter((l) => l.night === night && l.checked).map((l) => l.itemKey))
  const late = nightFlags(night, profile, protocol.sleepRules, data.caffeine, [], protocol.activityTypes).lateCaffeine
  const items = protocol.sleepRules.checklist
  const done = items.filter((i) => checked.has(i.key)).length

  const hint = (key: string): { text: string; warn?: boolean } | undefined => {
    if (key === 'temp') return { text: roomTempRange(protocol.sleepRules.roomTempC, profile.units) }
    if (key === 'shower') return { text: now < c.shower ? `At ${formatTime(c.shower)}` : `Was due at ${formatTime(c.shower)}` }
    if (key === 'caffeine') {
      if (late.length) {
        const l = late[late.length - 1]
        return { text: `${l.label} at ${formatTime(l.at)} was after ${formatTime(c.caffeineCutoff)}`, warn: true }
      }
      return { text: `Cutoff ${formatTime(c.caffeineCutoff)}` }
    }
    return undefined
  }

  return (
    <section aria-label="Tonight's checklist" className="mt-6 px-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-medium">Tonight's wind-down</h2>
        <span className="num text-sm text-ink-2">
          {done} of {items.length}
        </span>
      </div>
      <ul className="divide-y divide-line rounded-2xl bg-surface">
        {items.map((item) => {
          const on = checked.has(item.key)
          const h = hint(item.key)
          return (
            <li key={item.key}>
              <button
                role="checkbox"
                aria-checked={on}
                onClick={() => void setChecklistItem(night, item.key, !on)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
              >
                <span
                  aria-hidden="true"
                  className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2', on ? 'border-moderate bg-moderate text-surface' : 'border-ink-3')}
                >
                  {on && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M2.5 7.5l3 3 6-7" />
                    </svg>
                  )}
                </span>
                <span className="flex-1">
                  <span className={cx('block', on && 'text-ink-2')}>{item.label}</span>
                  {h && <span className={cx('block text-sm', h.warn ? 'text-amber' : 'text-ink-3')}>{h.text}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Caffeine({ profile, protocol, night, data, now }: { profile: Profile; protocol: ProtocolVersion; night: string; data: SleepData; now: number }) {
  const open = useUi((s) => s.open)
  const toast = useUi((s) => s.showToast)
  const today = toDateKey(now)
  const c = cutoffsFor(night, profile, protocol.sleepRules)
  const todays = data.caffeine.filter((l) => l.date === today).sort((a, b) => a.at - b.at)
  const total = todays.reduce((s, l) => s + l.mg, 0)
  const lastDrink = todays[todays.length - 1]
  const drinks = data.drinks.filter((d) => !d.hidden)

  let status: { text: string; warn?: boolean }
  if (!lastDrink) status = { text: now < c.caffeineCutoff ? `None yet. Cutoff ${formatTime(c.caffeineCutoff)}.` : `None today. The cutoff was ${formatTime(c.caffeineCutoff)}.` }
  else if (lastDrink.at > c.caffeineCutoff) status = { text: `Last at ${formatTime(lastDrink.at)}, after the ${formatTime(c.caffeineCutoff)} cutoff.`, warn: true }
  else status = { text: `Last at ${formatTime(lastDrink.at)}. Cutoff ${formatTime(c.caffeineCutoff)}.` }

  const log = async (d: DrinkPreset) => {
    const id = await logCaffeine(d)
    const after = Date.now() > c.caffeineCutoff
    toast({
      message: `${d.label}, ${d.defaultMg} mg${after ? ', after the cutoff' : ''}`,
      action: { label: 'Undo', run: () => void deleteCaffeine(id) },
    })
  }

  return (
    <section aria-label="Caffeine today" className="mt-6 px-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-medium">Caffeine today</h2>
        <span className="num text-xl font-semibold">{total} mg</span>
      </div>
      <div className="rounded-2xl bg-surface p-4">
        <p className={cx('mb-3 text-sm', status.warn ? 'text-amber' : 'text-ink-2')}>{status.text}</p>
        <div className="grid grid-cols-3 gap-2">
          {drinks.map((d) => (
            <button key={d.key} onClick={() => void log(d)} className="flex min-h-16 flex-col items-start justify-center rounded-xl border border-line px-3 text-left active:bg-sunk" aria-label={`Log ${d.label}, ${d.defaultMg} milligrams`}>
              <span className="text-sm font-medium leading-tight">{d.label}</span>
              <span className="num text-xs text-ink-2">{d.defaultMg} mg</span>
            </button>
          ))}
        </div>
        {todays.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {todays.map((l) => (
              <li key={l.id} className="flex items-center">
                <button onClick={() => open({ kind: 'drinkEdit', log: l })} className="flex min-h-12 flex-1 items-center justify-between pr-2 text-left">
                  <span>{l.label}</span>
                  <span className="flex items-baseline gap-3">
                    <span className="num text-sm text-ink-2">{l.mg} mg</span>
                    <span className={cx('num w-20 text-right text-sm', l.at > c.caffeineCutoff && 'text-amber')}>{formatTime(l.at)}</span>
                  </span>
                </button>
                <button
                  className="min-h-12 min-w-12 text-sm text-ink-3"
                  aria-label={`Remove ${l.label} at ${formatTime(l.at)}`}
                  onClick={async () => {
                    await deleteCaffeine(l.id)
                    toast({ message: `${l.label} removed`, action: { label: 'Undo', run: () => void restoreCaffeine(l.id) } })
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <button onClick={() => open({ kind: 'drinks' })} className="mt-2 min-h-11 text-sm font-medium text-moderate">
          Edit drinks and amounts
        </button>
      </div>
    </section>
  )
}

function History({ profile, protocol, last, data }: { profile: Profile; protocol: ProtocolVersion; last: string; data: SleepData }) {
  const open = useUi((s) => s.open)
  // Start at the first night with anything recorded, so a new install isn't a wall of empty rows.
  const recorded = [...data.sleepLogs.map((l) => l.night), ...data.checklist.filter((l) => l.checked).map((l) => l.night)].filter((n) => n <= last)
  const earliest = recorded.sort()[0]
  const nights = earliest
    ? Array.from({ length: HISTORY_NIGHTS }, (_, i) => addDaysKey(last, -i)).filter((n) => n >= earliest)
    : []
  const items = protocol.sleepRules.checklist.length
  if (nights.length === 0) {
    return (
      <section aria-label="Recent nights" className="mt-6 px-4">
        <h2 className="mb-2 font-medium">Recent nights</h2>
        <p className="rounded-2xl bg-surface px-4 py-4 text-sm text-ink-2">Nights you log show up here, with late caffeine or late hard exercise noted.</p>
      </section>
    )
  }

  return (
    <section aria-label="Recent nights" className="mt-6 px-4">
      <h2 className="mb-2 font-medium">{nights.length === HISTORY_NIGHTS ? 'Last 14 nights' : 'Recent nights'}</h2>
      <ul className="divide-y divide-line rounded-2xl bg-surface">
        {nights.map((n) => {
          const log = data.sleepLogs.find((l) => l.night === n)
          const flags = nightFlags(n, profile, protocol.sleepRules, data.caffeine, data.sessions, protocol.activityTypes)
          const ticks = data.checklist.filter((l) => l.night === n && l.checked).length
          const notes = [
            ticks > 0 && `Checklist ${ticks}/${items}`,
            flags.lateCaffeine.length > 0 && 'late caffeine',
            flags.lateSessions.length > 0 && 'late hard exercise',
          ].filter(Boolean) as string[]
          return (
            <li key={n}>
              <button onClick={() => open({ kind: 'sleepLog', night: n })} className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left active:bg-sunk">
                <span className="w-12 shrink-0">
                  <span className="block text-sm font-medium">{format(fromDateKey(n), 'EEE')}</span>
                  <span className="num block text-xs text-ink-3">{format(fromDateKey(n), 'MMM d')}</span>
                </span>
                <span className="min-w-0 flex-1">
                  {log ? (
                    <span className="num block text-sm">
                      {formatTime(log.bedAt)} to {formatTime(log.wakeAt)}
                    </span>
                  ) : (
                    <span className="block text-sm text-ink-3">Not logged</span>
                  )}
                  {notes.length > 0 && (
                    <span className="block text-xs text-ink-3">
                      {notes.map((t, i) => (
                        <span key={t} className={cx(t.startsWith('late') && 'text-amber')}>
                          {i > 0 ? ', ' : ''}
                          {i === 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                {log && (
                  <span className="shrink-0 text-right">
                    <span className="num block font-semibold">{formatDuration(Math.round((log.wakeAt - log.bedAt) / 60000))}</span>
                    <QualityPips q={log.quality} />
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function QualityPips({ q }: { q: number }) {
  return (
    <span className="mt-1 flex justify-end gap-0.5" role="img" aria-label={`Quality ${q} of 5, ${QUALITY_LABELS[q - 1]}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cx('h-1.5 w-2.5 rounded-full', i <= q ? 'bg-ink-2' : 'bg-line')} />
      ))}
    </span>
  )
}
