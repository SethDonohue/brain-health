import { weekTotals, type WeekTotals } from './cardio'
import { addDaysKey, weekDays } from './dates'
import { bandPoints, MIND_BANDS } from './mind'
import { intenseOnRestDay } from './plan'
import { currentNight, nightFlags } from './sleep'
import type {
  ActivityKey,
  CaffeineLog,
  ChecklistLog,
  DietGroup,
  PlannedSession,
  Profile,
  ProtocolVersion,
  ServingLog,
  SessionLog,
  SleepLog,
} from './types'

export interface WeekInput {
  sessions: SessionLog[]
  planned: PlannedSession[]
  servings: ServingLog[]
  sleepLogs: SleepLog[]
  checklist: ChecklistLog[]
  caffeine: CaffeineLog[]
}

// ---------- MIND score (F4.5) ----------

export interface MindPoint {
  key: string
  label: string
  points: 0 | 0.5 | 1
  /** what the week amounted to, e.g. "4 servings" or "1.3 a day" */
  detail: string
}

export interface MindScore {
  score: number
  max: number
  groups: MindPoint[]
  /** false when nothing was logged that week: an empty week isn't a score */
  logged: boolean
}

const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * Weekly MIND score using the published thresholds (Morris et al., 2015), read over one week.
 * Daily groups use the average per day over the days that have passed. Wine counts only when it is tracked;
 * otherwise the score is out of 14.
 */
export function mindScore(groups: DietGroup[], servings: ServingLog[], daysElapsed: number, wineEnabled: boolean): MindScore {
  const days = Math.max(1, daysElapsed)
  const total = (k: string) => servings.filter((s) => !s.deletedAt && s.dietGroupKey === k).reduce((a, s) => a + s.amount, 0)
  const daysWith = (k: string) => new Set(servings.filter((s) => !s.deletedAt && s.dietGroupKey === k).map((s) => s.date)).size
  const perDay = (k: string) => total(k) / days
  const n = (v: number, unit = 'serving') => `${v} ${v === 1 ? unit : `${unit}s`}`

  // Standard groups score straight from the shared study bands; olive oil and wine have their own rules.
  const standard = (k: string) => {
    const b = MIND_BANDS[k]
    const v = b.basis === 'day' ? perDay(k) : total(k)
    const unit = k === 'butter' ? 'tbsp' : 'serving'
    const detail = b.basis === 'day' ? `${r1(v)}${unit === 'tbsp' ? ' tbsp' : ''} a day` : n(v)
    return { points: bandPoints(b, v), detail }
  }
  const rules: Record<string, () => { points: 0 | 0.5 | 1; detail: string }> = {
    // "primary oil": counted when it was the main oil on at least half the days
    olive_oil: () => ({ points: daysWith('olive_oil') >= Math.ceil(days / 2) ? 1 : 0, detail: `${daysWith('olive_oil')} of ${days} days` }),
    wine: () => {
      const byDay = new Map<string, number>()
      for (const s of servings.filter((x) => !x.deletedAt && x.dietGroupKey === 'wine')) byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.amount)
      const overOne = [...byDay.values()].some((v) => v > 1)
      const t = total('wine')
      // Never better than one glass a day: any day above one scores 0.
      const points: 0 | 0.5 | 1 = overOne || t === 0 ? 0 : t / days >= 1 ? 1 : 0.5
      return { points, detail: `${t} ${t === 1 ? 'glass' : 'glasses'}` }
    },
  }
  for (const k of Object.keys(MIND_BANDS)) if (!rules[k]) rules[k] = () => standard(k)

  const counted = groups.filter((g) => rules[g.key] && (g.key !== 'wine' || wineEnabled))
  const out = counted.map((g) => ({ key: g.key, label: g.label, ...rules[g.key]() }))
  const logged = servings.some((s) => !s.deletedAt)
  return { score: out.reduce((a, g) => a + g.points, 0), max: out.length, groups: out, logged }
}

// ---------- Weekly report (F6.4) ----------

export interface WeekSummary {
  weekStart: string
  isCurrent: boolean
  /** days of the week that have started, 1–7 */
  daysElapsed: number
  totals: WeekTotals
  targets: { activityType: ActivityKey; done: number; target: number }[]
  strengthCount: number
  /** true/false once a rest day is planned; undefined if none */
  restKept?: boolean
  mind: MindScore
  sleep: {
    nightsCounted: number
    nightsLogged: number
    avgMin?: number
    avgQuality?: number
    checklistPct?: number
    lateCaffeineDays: number
    lateExerciseNights: number
  }
  caffeine: { avgMgPerDay: number; daysWithCaffeine: number }
}

export function summarizeWeek(weekStart: string, input: WeekInput, profile: Profile, protocol: ProtocolVersion, now: number = Date.now()): WeekSummary {
  const days = weekDays(weekStart)
  const tonight = currentNight(now)
  const isCurrent = tonight >= days[0] && tonight <= days[6]
  const elapsedDays = days.filter((d) => d <= tonight)
  const daysElapsed = Math.max(1, elapsedDays.length)
  const inWeek = (d: string) => d >= days[0] && d <= days[6]

  const sessions = input.sessions.filter((s) => !s.deletedAt && inWeek(s.date))
  const planned = input.planned.filter((p) => !p.deletedAt && p.weekStart === weekStart)
  const totals = weekTotals(sessions, protocol.activityTypes)
  const targets = protocol.weeklyTargets
    .filter((t) => t.activityType !== 'rest')
    .map((t) => ({ activityType: t.activityType, target: t.timesPerWeek, done: sessions.filter((s) => s.status === 'done' && s.activityType === t.activityType).length }))
  const rest = planned.find((p) => p.activityType === 'rest')
  const restKept = rest ? (rest.date <= tonight ? !intenseOnRestDay(rest.date, sessions, protocol.activityTypes) : undefined) : undefined

  const mind = mindScore(protocol.dietGroups, input.servings.filter((s) => inWeek(s.date)), daysElapsed, profile.wineEnabled)

  // Nights: every night of the week up to tonight.
  const nights = elapsedDays
  const logs = input.sleepLogs.filter((l) => !l.deletedAt && nights.includes(l.night))
  const items = protocol.sleepRules.checklist.length
  const ticks = input.checklist.filter((c) => !c.deletedAt && c.checked && nights.includes(c.night)).length
  let lateCaffeineDays = 0
  let lateExerciseNights = 0
  for (const n of nights) {
    const f = nightFlags(n, profile, protocol.sleepRules, input.caffeine, input.sessions, protocol.activityTypes)
    if (f.lateCaffeine.length) lateCaffeineDays++
    if (f.lateSessions.length) lateExerciseNights++
  }

  const caffeineInWeek = input.caffeine.filter((c) => !c.deletedAt && inWeek(c.date))
  const mg = caffeineInWeek.reduce((a, c) => a + c.mg, 0)

  return {
    weekStart,
    isCurrent,
    daysElapsed,
    totals,
    targets,
    strengthCount: totals.sessionsByType.strength ?? 0,
    restKept,
    mind,
    sleep: {
      nightsCounted: nights.length,
      nightsLogged: logs.length,
      avgMin: logs.length ? Math.round(logs.reduce((a, l) => a + (l.wakeAt - l.bedAt) / 60000, 0) / logs.length) : undefined,
      avgQuality: logs.length ? r1(logs.reduce((a, l) => a + l.quality, 0) / logs.length) : undefined,
      checklistPct: nights.length ? Math.round((ticks / (items * nights.length)) * 100) : undefined,
      lateCaffeineDays,
      lateExerciseNights,
    },
    caffeine: { avgMgPerDay: Math.round(mg / daysElapsed), daysWithCaffeine: new Set(caffeineInWeek.map((c) => c.date)).size },
  }
}

// ---------- Late nights vs other nights (F6.7) ----------

export function lateNightComparison(input: WeekInput, profile: Profile, protocol: ProtocolVersion) {
  const late: number[] = []
  const other: number[] = []
  for (const l of input.sleepLogs.filter((x) => !x.deletedAt)) {
    const f = nightFlags(l.night, profile, protocol.sleepRules, input.caffeine, input.sessions, protocol.activityTypes)
    ;(f.lateCaffeine.length || f.lateSessions.length ? late : other).push(l.quality)
  }
  const avg = (a: number[]) => (a.length ? r1(a.reduce((x, y) => x + y, 0) / a.length) : undefined)
  return { late: { n: late.length, avg: avg(late) }, other: { n: other.length, avg: avg(other) } }
}

// ---------- Suggestions (F6.6) ----------

export interface Suggestion {
  /** stable per rule and week, so a dismissal sticks */
  id: string
  ruleKey: string
  title: string
  body: string
}

/**
 * Rules from the spec, run on the current week and the weeks before it (newest first in `history`).
 * They only reshape the user's own plan; nothing is applied automatically.
 */
export function suggestions(current: WeekSummary, history: WeekSummary[], input: WeekInput, profile: Profile, protocol: ProtocolVersion): Suggestion[] {
  const out: Suggestion[] = []
  const id = (k: string) => `${k}:${current.weekStart}`
  const label = (k: string) => protocol.activityTypes.find((a) => a.key === k)?.label ?? k
  const lastTwo = history.slice(0, 2)

  // Late sessions hurt sleep: quality ≤ 2 on 2+ nights after a session inside the 4-hour buffer.
  const nights = weekDays(current.weekStart)
  const poorAfterLate = input.sleepLogs.filter((l) => {
    if (l.deletedAt || !nights.includes(l.night) || l.quality > 2) return false
    return nightFlags(l.night, profile, protocol.sleepRules, [], input.sessions, protocol.activityTypes).lateSessions.length > 0
  })
  if (poorAfterLate.length >= 2) {
    out.push({
      id: id('late_sessions'),
      ruleKey: 'late_sessions',
      title: 'Late sessions and poor sleep',
      body: `You slept poorly on ${poorAfterLate.length} nights after exercise that ran past your cutoff. Try moving strength earlier in the afternoon, or moving that day's session.`,
    })
  }

  // Late caffeine on 3+ days this week.
  if (current.sleep.lateCaffeineDays >= 3) {
    const late = nights.flatMap((n) => nightFlags(n, profile, protocol.sleepRules, input.caffeine, [], protocol.activityTypes).lateCaffeine)
    const counts = new Map<string, number>()
    for (const c of late) counts.set(c.label, (counts.get(c.label) ?? 0) + 1)
    const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    out.push({
      id: id('late_caffeine'),
      ruleKey: 'late_caffeine',
      title: 'Caffeine after the cutoff',
      body: `${current.sleep.lateCaffeineDays} days this week had caffeine after the cutoff${usual ? `, usually ${usual.toLowerCase()}` : ''}. Moving that drink earlier, or switching to decaf after lunch, keeps the cutoff.`,
    })
  }

  // No rest day for 2 weeks running.
  if (lastTwo.length === 2 && lastTwo.every((w) => w.restKept === false)) {
    out.push({ id: id('rest_lost'), ruleKey: 'rest_lost', title: 'No full rest day lately', body: 'The last two weeks had hard activity on the rest day. Pick a rest day for next week in Train and keep it free.' })
  }

  // An activity target missed 2 weeks running.
  if (lastTwo.length === 2) {
    for (const t of protocol.weeklyTargets.filter((x) => x.activityType !== 'rest')) {
      const missed = lastTwo.every((w) => (w.targets.find((x) => x.activityType === t.activityType)?.done ?? 0) < t.timesPerWeek)
      if (missed) {
        out.push({
          id: id(`missed_${t.activityType}`),
          ruleKey: 'missed_target',
          title: `${label(t.activityType)} below target`,
          body: `${label(t.activityType)} fell short of ${t.timesPerWeek} a week for two weeks. Consider moving it to a day that usually works, or lowering the target for now.`,
        })
      }
    }
  }

  // Cardio spike: > 130% of the 4-week average.
  const prior = history.slice(0, 4)
  if (prior.length === 4) {
    const avg = prior.reduce((a, w) => a + w.totals.cardioModerateEqMin, 0) / 4
    if (avg > 0 && current.totals.cardioModerateEqMin > avg * 1.3) {
      out.push({
        id: id('cardio_spike'),
        ruleKey: 'cardio_spike',
        title: 'A big jump in cardio',
        body: `This week is at ${current.totals.cardioModerateEqMin} moderate-equivalent minutes, well above your 4-week average of ${Math.round(avg)}. Swapping one session for an easier ride or a rest day helps recovery.`,
      })
    }
  }

  // "Do" groups that scored nothing for the last three complete, logged weeks: one card for all of them.
  const three = history.slice(0, 3)
  if (three.length === 3 && three.every((w) => w.mind.logged)) {
    const gaps = protocol.dietGroups.filter((g) => g.kind === 'do' && !g.optional && three.every((w) => (w.mind.groups.find((x) => x.key === g.key)?.points ?? 0) === 0))
    if (gaps.length) {
      const names = gaps.map((g) => g.label.toLowerCase())
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      const meal = [...protocol.mealTemplates].sort(
        (a, b) => b.servings.filter((s) => gaps.some((g) => g.key === s.dietGroupKey)).length - a.servings.filter((s) => gaps.some((g) => g.key === s.dietGroupKey)).length,
      )[0]
      const covered = meal ? gaps.filter((g) => meal.servings.some((s) => s.dietGroupKey === g.key)).map((g) => g.label.toLowerCase()) : []
      out.push({
        id: id('mind_gap'),
        ruleKey: 'mind_gap',
        title: names.length === 1 ? `${gaps[0].label} missing for three weeks` : 'A few food groups missing',
        body: `For the last three weeks, ${list} scored nothing on the MIND score.${covered.length ? ` Your ${meal!.label.toLowerCase()} covers ${covered.join(' and ')}.` : ''}`,
      })
    }
  }

  return out
}

export const weekStartsBack = (weekStart: string, n: number) => Array.from({ length: n }, (_, i) => addDaysKey(weekStart, -7 * i))
