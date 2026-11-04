import { atMinutes, hmToMinutes, isoWeekday } from './dates'
import type { Profile, SleepRules } from './types'

/** Bedtimes earlier than noon are treated as after midnight (e.g. 00:30 belongs to the previous evening). */
const NOON = 12 * 60

/** Bedtime string for a night: weekday override, else default. */
export const bedtimeFor = (night: string, profile: Pick<Profile, 'bedtimeDefault' | 'bedtimeByWeekday'>): string =>
  profile.bedtimeByWeekday[isoWeekday(night)] ?? profile.bedtimeDefault

/** Epoch ms of bedtime for the night that starts on `night` (a local date). */
export function bedtimeAt(night: string, profile: Pick<Profile, 'bedtimeDefault' | 'bedtimeByWeekday'>): number {
  let m = hmToMinutes(bedtimeFor(night, profile))
  if (m < NOON) m += 24 * 60
  return atMinutes(night, m)
}

export interface Cutoffs {
  bedtime: number
  caffeineCutoff: number
  exerciseCutoff: number
  shower: number
}

const H = 3_600_000
const MIN = 60_000

export function cutoffsFor(
  night: string,
  profile: Pick<Profile, 'bedtimeDefault' | 'bedtimeByWeekday'>,
  rules: Pick<SleepRules, 'caffeineCutoffHours' | 'exerciseCutoffHours' | 'showerMinutesBefore'>,
): Cutoffs {
  const b = bedtimeAt(night, profile)
  return {
    bedtime: b,
    caffeineCutoff: b - rules.caffeineCutoffHours * H,
    exerciseCutoff: b - rules.exerciseCutoffHours * H,
    shower: b - rules.showerMinutesBefore * MIN,
  }
}
