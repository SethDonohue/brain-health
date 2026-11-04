import type { ActivityKey, ActivityType, Intensity, SessionLog } from './types'

/** WHO equivalence: light 0×, moderate 1×, vigorous 2×. */
export const INTENSITY_FACTOR: Record<Intensity, number> = { light: 0, moderate: 1, vigorous: 2 }

export const moderateEquivalent = (durationMin: number, intensity: Intensity): number =>
  durationMin * INTENSITY_FACTOR[intensity]

export interface WeekTotals {
  totalExerciseMin: number
  moderateMin: number
  vigorousMin: number
  lightMin: number
  cardioModerateEqMin: number
  sessionsByType: Partial<Record<ActivityKey, number>>
}

/** Aggregate done (not skipped/active, not deleted) logs. Totals use the logged intensity, never the default. */
export function weekTotals(logs: SessionLog[], activityTypes: ActivityType[]): WeekTotals {
  const byKey = new Map(activityTypes.map((a) => [a.key, a]))
  const t: WeekTotals = {
    totalExerciseMin: 0,
    moderateMin: 0,
    vigorousMin: 0,
    lightMin: 0,
    cardioModerateEqMin: 0,
    sessionsByType: {},
  }
  for (const log of logs) {
    if (log.deletedAt || log.status !== 'done' || log.activityType === 'rest') continue
    t.totalExerciseMin += log.durationMin
    t.sessionsByType[log.activityType] = (t.sessionsByType[log.activityType] ?? 0) + 1
    if (!byKey.get(log.activityType)?.isCardio) continue
    if (log.intensity === 'moderate') t.moderateMin += log.durationMin
    else if (log.intensity === 'vigorous') t.vigorousMin += log.durationMin
    else t.lightMin += log.durationMin
    t.cardioModerateEqMin += moderateEquivalent(log.durationMin, log.intensity)
  }
  return t
}

export type CardioStatus = 'below' | 'floor' | 'target'
export const cardioStatus = (eq: number, floor: number, target: number): CardioStatus =>
  eq >= target ? 'target' : eq >= floor ? 'floor' : 'below'
