import { addDaysKey, atMinutes, hmToMinutes, toDateKey } from './dates'
import { cutoffsFor } from './sleepTimes'
import { DEFAULT_TAB_ORDER } from './types'
import type { ActivityType, CaffeineLog, Profile, SessionLog, SleepRules, TabKey } from './types'

/** Nights run until 4 am: at 1 am you are still in the night that started yesterday evening. */
const NIGHT_ROLLOVER_HOUR = 4

/** The night that is current (tonight, or the one in progress after midnight), as its evening's date. */
export function currentNight(now: number = Date.now()): string {
  const d = new Date(now)
  if (d.getHours() < NIGHT_ROLLOVER_HOUR) d.setDate(d.getDate() - 1)
  return toDateKey(d)
}

/** The most recent night that has ended: the one to log in the morning. */
export const lastNight = (now: number = Date.now()): string => addDaysKey(currentNight(now), -1)

/**
 * Bed and wake instants for a night from clock times. Bed before noon is after midnight;
 * wake is the next morning, pushed a day later if it would fall before bed.
 */
export function nightTimes(night: string, bedHm: string, wakeHm: string): { bedAt: number; wakeAt: number } {
  let b = hmToMinutes(bedHm)
  if (b < 12 * 60) b += 24 * 60
  const bedAt = atMinutes(night, b)
  let wakeAt = atMinutes(night, hmToMinutes(wakeHm) + 24 * 60)
  if (wakeAt <= bedAt) wakeAt = atMinutes(night, hmToMinutes(wakeHm) + 48 * 60)
  return { bedAt, wakeAt }
}

export interface NightFlags {
  /** caffeine after the cutoff that day (F3.6) */
  lateCaffeine: CaffeineLog[]
  /** hard sessions ending inside the pre-bed buffer (F3.6) */
  lateSessions: SessionLog[]
}

export function nightFlags(
  night: string,
  profile: Pick<Profile, 'bedtimeDefault' | 'bedtimeByWeekday'>,
  rules: Pick<SleepRules, 'caffeineCutoffHours' | 'exerciseCutoffHours' | 'showerMinutesBefore'>,
  caffeine: CaffeineLog[],
  sessions: SessionLog[],
  types: ActivityType[],
): NightFlags {
  const c = cutoffsFor(night, profile, rules)
  const byKey = new Map(types.map((t) => [t.key, t]))
  return {
    lateCaffeine: caffeine.filter((l) => !l.deletedAt && l.at > c.caffeineCutoff && l.at < c.bedtime),
    lateSessions: sessions.filter((s) => {
      if (s.deletedAt || s.status !== 'done' || s.date !== night) return false
      const hard = byKey.get(s.activityType)?.isIntense || s.intensity === 'vigorous'
      return hard && s.startAt + s.durationMin * 60_000 > c.exerciseCutoff
    }),
  }
}

export const QUALITY_LABELS = ['Poor', 'Fair', 'OK', 'Good', 'Great'] as const

/** A saved order with unknown tabs dropped and missing ones appended, so new tabs always show up. */
export function normalizeTabOrder(saved: TabKey[] | undefined): TabKey[] {
  const valid = (saved ?? []).filter((t, i, a) => DEFAULT_TAB_ORDER.includes(t) && a.indexOf(t) === i)
  return [...valid, ...DEFAULT_TAB_ORDER.filter((t) => !valid.includes(t))]
}

export function moveTab(order: TabKey[], tab: TabKey, delta: -1 | 1): TabKey[] {
  const i = order.indexOf(tab)
  const j = i + delta
  if (i < 0 || j < 0 || j >= order.length) return order
  const next = [...order]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}
