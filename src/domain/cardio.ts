import type { ActivityKey, ActivityType, Intensity, SessionLog } from './types'

/** WHO equivalence: light 0×, moderate 1×, vigorous 2×. */
export const INTENSITY_FACTOR: Record<Intensity, number> = { light: 0, moderate: 1, vigorous: 2 }

export const moderateEquivalent = (durationMin: number, intensity: Intensity): number =>
  durationMin * INTENSITY_FACTOR[intensity]

/** A log as (minutes, intensity) pieces: a split ride gives its two parts, anything else gives itself. */
export function logPieces(log: SessionLog): { min: number; intensity: Intensity }[] {
  return log.parts
    ? [
        { min: log.parts.climb.min, intensity: log.parts.climb.intensity },
        { min: log.parts.descent.min, intensity: log.parts.descent.intensity },
      ].filter((x) => x.min > 0)
    : [{ min: log.durationMin, intensity: log.intensity }]
}

/** Moderate-equivalent cardio minutes for one log (0 when it isn't a done cardio log is the caller's job). */
export const logModerateEq = (log: SessionLog): number => logPieces(log).reduce((n, x) => n + moderateEquivalent(x.min, x.intensity), 0)

/** The ride's two parts as the owner says it: "45 min up, 30 min down" (formatMin turns minutes into text). */
export const ridePartsText = (log: Pick<SessionLog, 'parts'>, formatMin: (m: number) => string): string | undefined =>
  log.parts ? `${formatMin(log.parts.climb.min)} up, ${formatMin(log.parts.descent.min)} down` : undefined

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
    for (const { min, intensity } of logPieces(log)) {
      if (intensity === 'moderate') t.moderateMin += min
      else if (intensity === 'vigorous') t.vigorousMin += min
      else t.lightMin += min
      t.cardioModerateEqMin += moderateEquivalent(min, intensity)
    }
  }
  return t
}

export type CardioStatus = 'below' | 'floor' | 'target'
export const cardioStatus = (eq: number, floor: number, target: number): CardioStatus =>
  eq >= target ? 'target' : eq >= floor ? 'floor' : 'below'
