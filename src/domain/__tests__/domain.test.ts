import { describe, expect, it } from 'vitest'
import { moderateEquivalent, weekTotals, cardioStatus } from '../cardio'
import { cutoffsFor, bedtimeAt } from '../sleepTimes'
import { generateWeek, checkRestDay, targetProgress } from '../plan'
import { protocolV1, validateProtocol } from '../protocol.v1'
import { displayToKg, fmtWeight, roomTempRange } from '../units'
import { weekStartOf, isoWeekday } from '../dates'
import type { PlannedSession, SessionLog } from '../types'

const P = protocolV1
const log = (o: Partial<SessionLog>): SessionLog => ({
  id: Math.random().toString(), createdAt: 0, updatedAt: 0, date: '2026-11-02', activityType: 'pickleball',
  startAt: 0, durationMin: 60, intensity: 'moderate', status: 'done', protocolVersion: 1, ...o,
})

describe('protocol seed', () => {
  it('validates with 15 diet groups', () => {
    expect(validateProtocol(P).dietGroups).toHaveLength(15)
  })
  it('rejects malformed edits', () => {
    expect(() => validateProtocol({ ...P, dietGroups: P.dietGroups.slice(1) })).toThrow()
  })
})

describe('cardio', () => {
  it('weights intensity 0/1/2', () => {
    expect(moderateEquivalent(60, 'light')).toBe(0)
    expect(moderateEquivalent(60, 'moderate')).toBe(60)
    expect(moderateEquivalent(150, 'vigorous')).toBe(300)
  })
  it('aggregates with logged intensity, excludes strength from cardio, skips skipped/deleted', () => {
    const t = weekTotals([
      log({ durationMin: 120 }),
      log({ activityType: 'mtb', durationMin: 40, intensity: 'vigorous' }),
      log({ activityType: 'bike_commute', durationMin: 20, intensity: 'vigorous' }),
      log({ activityType: 'strength', durationMin: 50 }),
      log({ durationMin: 90, status: 'skipped' }),
      log({ durationMin: 90, deletedAt: 1 }),
    ], P.activityTypes)
    expect(t.totalExerciseMin).toBe(230)
    expect(t.moderateMin).toBe(120)
    expect(t.vigorousMin).toBe(60)
    expect(t.cardioModerateEqMin).toBe(240)
    expect(cardioStatus(t.cardioModerateEqMin, 150, 300)).toBe('floor')
  })
})

describe('sleep cutoffs', () => {
  const profile = { bedtimeDefault: '22:30', bedtimeByWeekday: {} }
  it('derives caffeine 12:30, exercise 18:30, shower 21:00 for 22:30 bedtime', () => {
    const c = cutoffsFor('2026-11-02', profile, P.sleepRules)
    const hm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
    expect(hm(c.caffeineCutoff)).toBe('12:30')
    expect(hm(c.exerciseCutoff)).toBe('18:30')
    expect(hm(c.shower)).toBe('21:00')
  })
  it('treats a bedtime past midnight as the next calendar day', () => {
    const b = new Date(bedtimeAt('2026-11-02', { bedtimeDefault: '00:30', bedtimeByWeekday: {} }))
    expect(b.getDate()).toBe(3)
    expect(b.getHours()).toBe(0)
  })
  it('uses weekday overrides', () => {
    const b = new Date(bedtimeAt('2026-11-07', { bedtimeDefault: '22:30', bedtimeByWeekday: { 6: '23:30' } }))
    expect(b.getHours()).toBe(23)
  })
  it('handles a DST change across the cutoff window', () => {
    // US DST ended 2026-11-01 at 02:00; a 10 h cutoff from 00:30 on 1 Nov still lands at wall-clock 14:30 the day before
    const c = cutoffsFor('2026-10-31', { bedtimeDefault: '00:30', bedtimeByWeekday: {} }, P.sleepRules)
    expect(c.bedtime - c.caffeineCutoff).toBe(10 * 3600_000)
  })
})

describe('weekly plan', () => {
  const ws = '2026-11-02'
  it('generates default placement', () => {
    const w = generateWeek(ws, P.weeklyTargets, 7)
    expect(w.filter((x) => x.activityType === 'pickleball').map((x) => isoWeekday(x.date))).toEqual([1, 2, 4, 5])
    expect(w.find((x) => x.activityType === 'mtb')!.date).toBe('2026-11-07')
    expect(w.find((x) => x.activityType === 'rest')!.date).toBe('2026-11-08')
  })
  it('flags a rest-day conflict when MTB moves to Sunday', () => {
    const planned = generateWeek(ws, P.weeklyTargets, 7).map((x, i) => ({ ...x, id: String(i), createdAt: 0, updatedAt: 0 })) as PlannedSession[]
    planned.find((p) => p.activityType === 'mtb')!.date = '2026-11-08'
    const r = checkRestDay(ws, planned, P.activityTypes)
    expect(r.conflict).toBe(true)
    expect(r.candidates).toEqual(['2026-11-04', '2026-11-07'])
  })
  it('counts unplanned logs toward targets', () => {
    const tp = targetProgress(P.weeklyTargets, [], [log({}), log({})])
    expect(tp.find((t) => t.activityType === 'pickleball')!.done).toBe(2)
  })
  it('weeks start Monday', () => {
    expect(weekStartOf('2026-11-08')).toBe('2026-11-02')
  })
})

describe('units', () => {
  it('round-trips lb ↔ kg', () => {
    expect(fmtWeight(displayToKg(135, 'imperial'), 'imperial')).toBe('135')
    expect(fmtWeight(60, 'metric')).toBe('60')
  })
  it('shows room temp in both systems', () => {
    expect(roomTempRange([15, 19], 'metric')).toBe('15–19 °C')
    expect(roomTempRange([15, 19], 'imperial')).toBe('59–66 °F')
  })
})
