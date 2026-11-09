import { addDays, format, getISODay, parseISO, startOfISOWeek } from 'date-fns'
import type { IsoWeekday } from './types'

/** Local calendar date as 'yyyy-MM-dd'. */
export const toDateKey = (d: Date | number): string => format(d, 'yyyy-MM-dd')
export const fromDateKey = (key: string): Date => parseISO(key)
export const todayKey = (): string => toDateKey(new Date())

/** Monday of the ISO week containing the date. */
export const weekStartOf = (key: string): string => toDateKey(startOfISOWeek(fromDateKey(key)))
export const addDaysKey = (key: string, n: number): string => toDateKey(addDays(fromDateKey(key), n))
export const isoWeekday = (key: string): IsoWeekday => getISODay(fromDateKey(key)) as IsoWeekday

/** The 7 date keys Mon–Sun for a week start. */
export const weekDays = (weekStart: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i))

export const dateForWeekday = (weekStart: string, wd: IsoWeekday): string => addDaysKey(weekStart, wd - 1)

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export const weekdayShort = (wd: IsoWeekday) => WEEKDAY_SHORT[wd - 1]
export const weekdayLong = (wd: IsoWeekday) => WEEKDAY_LONG[wd - 1]

/** Parse 'HH:mm' into minutes after midnight. */
export const hmToMinutes = (hm: string): number => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

/** Epoch ms for a local clock time on a date key; minutes may exceed 24h (rolls into the next day). */
export const atMinutes = (dateKey: string, minutes: number): number => {
  const d = fromDateKey(dateKey)
  d.setHours(0, 0, 0, 0)
  // setMinutes handles overflow and local DST correctly
  d.setMinutes(minutes)
  return d.getTime()
}

export const formatTime = (ms: number): string => format(ms, 'h:mm a')

export const formatDuration = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m}`
}

/** '15:00' + 120 min to '3–5 PM'; '11:00' + 90 to '11 AM–12:30 PM'; no length gives just the start. */
export function formatTimeRange(start: string, durationMin?: number) {
  if (!durationMin) return formatClock(start)
  const [h, m] = start.split(':').map(Number)
  const end = (h * 60 + m + durationMin) % (24 * 60)
  const endStr = formatClock(`${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`)
  const a = formatClock(start)
  const sameHalf = a.slice(-2) === endStr.slice(-2)
  return `${sameHalf ? a.slice(0, -3) : a}–${endStr}`
}

/** '15:00' to '3 PM', '15:30' to '3:30 PM' */
export function formatClock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  const ap = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`
}

