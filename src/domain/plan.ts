import { addDaysKey, dateForWeekday, isoWeekday, weekDays, weeksBetween } from './dates'
import type { ActivityKey, ActivityType, IsoWeekday, PlannedSession, SessionLog, Slot, UsualWeekItem, WeeklyTarget } from './types'

export type PlannedDraft = Omit<PlannedSession, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>

/** How many times a target asks for in a given week: 0 on the "off" weeks of an every-other-week target. */
export function timesThisWeek(t: Pick<WeeklyTarget, 'timesPerWeek' | 'everyWeeks' | 'anchorWeek'>, weekStart: string): number {
  const every = t.everyWeeks ?? 1
  if (every <= 1 || !t.anchorWeek) return t.timesPerWeek
  return ((weeksBetween(t.anchorWeek, weekStart) % every) + every) % every === 0 ? t.timesPerWeek : 0
}

/** Build a week's planned sessions from the weekly targets. The rest target uses the profile's rest day. */
export function generateWeek(weekStart: string, allTargets: WeeklyTarget[], restDay: IsoWeekday): PlannedDraft[] {
  const out: PlannedDraft[] = []
  const targets = allTargets.map((t) => ({ ...t, timesPerWeek: timesThisWeek(t, weekStart) }))
  const busy = new Set<IsoWeekday>([restDay])
  for (const t of targets) if (t.activityType !== 'rest') t.defaultDays.slice(0, t.timesPerWeek).forEach((d) => busy.add(d))
  for (const t of targets) {
    const days = t.activityType === 'rest' ? [restDay] : t.defaultDays.slice(0, t.timesPerWeek)
    // a target raised above its default days: put the extra sessions on free days, then any other day but the rest day
    const all = [1, 2, 3, 4, 5, 6, 7] as IsoWeekday[]
    for (const pool of [all.filter((d) => !busy.has(d)), all.filter((d) => d !== restDay)]) {
      for (const d of pool) {
        if (t.activityType === 'rest' || days.length >= t.timesPerWeek) break
        if (!days.includes(d)) {
          days.push(d)
          busy.add(d)
        }
      }
    }
    days.sort((a, b) => a - b)
    for (const wd of days) {
      out.push({ weekStart, date: dateForWeekday(weekStart, wd), activityType: t.activityType, slot: t.slot, origin: 'template' })
    }
  }
  return out
}

/** Build a week from the user's saved usual week. Activities on an every-other-week target are left out on their off weeks. */
export function weekFromUsual(weekStart: string, items: UsualWeekItem[], targets: WeeklyTarget[] = []): PlannedDraft[] {
  const off = new Set(targets.filter((t) => (t.everyWeeks ?? 1) > 1 && timesThisWeek(t, weekStart) === 0).map((t) => t.activityType))
  return items.filter((i) => !off.has(i.activityType)).map((i) => ({
    weekStart,
    date: dateForWeekday(weekStart, i.weekday),
    activityType: i.activityType,
    slot: i.slot,
    origin: 'template' as const, // times and notes saved by Build 7–8 are ignored: the usual week is untimed
  }))
}

/** A week's planned sessions as a usual week (weekday and slot only: bookings change week to week, so times and booking notes aren't kept). */
export function usualFromWeek(planned: PlannedSession[]): UsualWeekItem[] {
  return planned
    .filter((p) => !p.deletedAt)
    .sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))
    .map((p) => ({ weekday: isoWeekday(p.date), activityType: p.activityType, slot: p.slot }))
}

/** Order within a day: timed sessions earliest first, then untimed ones (morning before afternoon). */
export function byTime(a: Pick<PlannedSession, 'startTime' | 'slot'>, b: Pick<PlannedSession, 'startTime' | 'slot'>) {
  if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime)
  if (a.startTime) return -1
  if (b.startTime) return 1
  return a.slot.localeCompare(b.slot)
}

/** 'HH:mm' to a slot: before noon is morning. */
export const slotOf = (hhmm: string): Slot => (Number(hhmm.slice(0, 2)) < 12 ? 'am' : 'pm')

export type PlanStatus = 'planned' | 'done' | 'skipped'

/** Status of a planned session from its linked logs (latest wins). */
export function plannedStatus(p: PlannedSession, logs: SessionLog[]): PlanStatus {
  const linked = logs.filter((l) => !l.deletedAt && l.plannedSessionId === p.id && l.status !== 'active')
  if (linked.some((l) => l.status === 'done')) return 'done'
  if (linked.some((l) => l.status === 'skipped')) return 'skipped'
  return 'planned'
}

export interface TargetProgress {
  activityType: ActivityKey
  target: number
  done: number
  planned: number
}

/** Per-target progress for a week: done counts every done log of that type (planned or not). Off weeks are left out. */
export function targetProgress(targets: WeeklyTarget[], weekStart: string, planned: PlannedSession[], logs: SessionLog[]): TargetProgress[] {
  return targets
    .filter((t) => t.activityType !== 'rest' && timesThisWeek(t, weekStart) > 0)
    .map((t) => ({
      activityType: t.activityType,
      target: timesThisWeek(t, weekStart),
      done: logs.filter((l) => !l.deletedAt && l.activityType === t.activityType && l.status === 'done').length,
      planned: planned.filter((p) => !p.deletedAt && p.activityType === t.activityType).length,
    }))
}

/** Dates in the week with no intense activity planned (candidate rest days). */
export function freeDays(weekStart: string, planned: PlannedSession[], types: ActivityType[]): string[] {
  const intense = new Set(types.filter((t) => t.isIntense).map((t) => t.key))
  return weekDays(weekStart).filter(
    (d) => !planned.some((p) => !p.deletedAt && p.date === d && intense.has(p.activityType)),
  )
}

export interface RestCheck {
  /** the planned rest session collides with an intense session on the same day */
  conflict: boolean
  restDate?: string
  /** days that could become the rest day */
  candidates: string[]
}

/** F1.2: after a move, check the rest day still holds. */
export function checkRestDay(weekStart: string, planned: PlannedSession[], types: ActivityType[]): RestCheck {
  const rest = planned.find((p) => !p.deletedAt && p.activityType === 'rest')
  const candidates = freeDays(weekStart, planned, types)
  if (!rest) return { conflict: candidates.length > 0, candidates }
  return { conflict: !candidates.includes(rest.date), restDate: rest.date, candidates }
}

/** F1.7: logged intense activity on the rest day, for a gentle warning. */
export function intenseOnRestDay(restDate: string | undefined, logs: SessionLog[], types: ActivityType[]): boolean {
  if (!restDate) return false
  const intense = new Set(types.filter((t) => t.isIntense).map((t) => t.key))
  return logs.some((l) => !l.deletedAt && l.status === 'done' && l.date === restDate && intense.has(l.activityType))
}

export { isoWeekday }

/** The protocol version that applied to a week: the latest saved on or before its last day (edits apply from the week they're made). */
export function protocolForWeek<P extends { version: number; effectiveFrom: string }>(versions: P[], weekStart: string): P | undefined {
  if (!versions.length) return undefined
  const end = addDaysKey(weekStart, 6)
  const sorted = [...versions].sort((a, b) => a.version - b.version)
  return [...sorted].reverse().find((v) => v.effectiveFrom <= end) ?? sorted[0]
}
