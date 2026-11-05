import { dateForWeekday, isoWeekday, weekDays } from './dates'
import type { ActivityKey, ActivityType, IsoWeekday, PlannedSession, SessionLog, Slot, UsualWeekItem, WeeklyTarget } from './types'

export type PlannedDraft = Omit<PlannedSession, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>

/** Build a week's planned sessions from the weekly targets. The rest target uses the profile's rest day. */
export function generateWeek(weekStart: string, targets: WeeklyTarget[], restDay: IsoWeekday): PlannedDraft[] {
  const out: PlannedDraft[] = []
  for (const t of targets) {
    const days = t.activityType === 'rest' ? [restDay] : t.defaultDays.slice(0, t.timesPerWeek)
    for (const wd of days) {
      out.push({ weekStart, date: dateForWeekday(weekStart, wd), activityType: t.activityType, slot: t.slot, origin: 'template' })
    }
  }
  return out
}

/** Build a week from the user's saved usual week. */
export function weekFromUsual(weekStart: string, items: UsualWeekItem[]): PlannedDraft[] {
  return items.map((i) => ({
    weekStart,
    date: dateForWeekday(weekStart, i.weekday),
    activityType: i.activityType,
    slot: i.slot,
    origin: 'template' as const,
    ...(i.startTime ? { startTime: i.startTime } : {}),
    ...(i.durationMin ? { durationMin: i.durationMin } : {}),
    ...(i.note ? { note: i.note } : {}),
  }))
}

/** A week's planned sessions as a usual week (weekday-based, keeps times and notes). */
export function usualFromWeek(planned: PlannedSession[]): UsualWeekItem[] {
  return planned
    .filter((p) => !p.deletedAt)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? a.slot).localeCompare(b.startTime ?? b.slot))
    .map((p) => ({
      weekday: isoWeekday(p.date),
      activityType: p.activityType,
      slot: p.slot,
      ...(p.startTime ? { startTime: p.startTime } : {}),
      ...(p.durationMin ? { durationMin: p.durationMin } : {}),
      ...(p.note ? { note: p.note } : {}),
    }))
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

/** Per-target progress for a week: done counts every done log of that type (planned or not). */
export function targetProgress(targets: WeeklyTarget[], planned: PlannedSession[], logs: SessionLog[]): TargetProgress[] {
  return targets
    .filter((t) => t.activityType !== 'rest')
    .map((t) => ({
      activityType: t.activityType,
      target: t.timesPerWeek,
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
