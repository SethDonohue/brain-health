import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from './db/db'
import { alive, currentProtocol, ensureWeek, getProfile, weekRange } from './db/repo'
import { addDaysKey, todayKey, weekStartOf } from './domain/dates'
import type { ActivityKey, ActivityType, PlannedSession, Profile, ProtocolVersion, SessionLog } from './domain/types'

export const useProfile = (): Profile | undefined => useLiveQuery(() => getProfile(), [])
/**
 * The protocol in effect, with the user's own activities merged into activityTypes so every lookup and
 * total sees them. Removed ones stay (marked hidden) so past logs keep their names.
 */
export const useProtocol = (): ProtocolVersion | undefined =>
  useLiveQuery(async () => {
    const [p, custom] = await Promise.all([currentProtocol(), db.customActivities.toArray()])
    const extra: ActivityType[] = custom
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ createdAt: _c, updatedAt: _u, deletedAt, ...a }) => ({ ...a, custom: true, hidden: deletedAt != null }))
    return { ...p, activityTypes: [...p.activityTypes, ...extra] }
  }, [])

/** True when a session at this intensity falls under the pre-bed buffer. */
export const countsAsHard = (a: ActivityType | undefined, intensity: string) => !!a?.isIntense || intensity === 'vigorous'

/** Today's date key, refreshed when the app returns to the foreground or the minute ticks over midnight. */
export function useToday(): string {
  const [key, setKey] = useState(todayKey())
  useEffect(() => {
    const tick = () => setKey(todayKey())
    const id = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return key
}

/** Re-renders every 30 s so countdowns stay current. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export interface WeekData {
  weekStart: string
  planned: PlannedSession[]
  logs: SessionLog[]
  lastWeekLogs: SessionLog[]
}

export function useWeek(dateKey: string): WeekData | undefined {
  const weekStart = weekStartOf(dateKey)
  useEffect(() => {
    void ensureWeek(dateKey)
  }, [dateKey])
  return useLiveQuery(async () => {
    const [from, to] = weekRange(weekStart)
    const lastStart = addDaysKey(weekStart, -7)
    const [planned, logs, lastWeekLogs] = await Promise.all([
      db.plannedSessions.where('weekStart').equals(weekStart).toArray(),
      db.sessionLogs.where('date').between(from, to, true, true).toArray(),
      db.sessionLogs.where('date').between(lastStart, addDaysKey(lastStart, 6), true, true).toArray(),
    ])
    return {
      weekStart,
      planned: alive(planned).sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot)),
      logs: alive(logs),
      lastWeekLogs: alive(lastWeekLogs),
    }
  }, [weekStart])
}

export const activityOf = (p: ProtocolVersion | undefined, key: ActivityKey): ActivityType | undefined =>
  p?.activityTypes.find((a) => a.key === key)

export const targetOf = (p: ProtocolVersion | undefined, key: ActivityKey) =>
  p?.weeklyTargets.find((t) => t.activityType === key)
