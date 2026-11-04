import { describe, expect, it } from 'vitest'
import { mindScore, summarizeWeek, suggestions, type WeekInput } from '../weekly'
import { protocolV1 } from '../protocol.v1'
import type { CaffeineLog, Profile, ServingLog, SessionLog, SleepLog } from '../types'

const P = protocolV1
const profile = { bedtimeDefault: '22:30', bedtimeByWeekday: {}, wakeDefault: '07:00', wineEnabled: false, units: 'imperial' } as unknown as Profile
const base = { createdAt: 0, updatedAt: 0 }
const at = (d: string, hm: string) => new Date(`${d}T${hm}:00`).getTime()
const sv = (key: string, date: string, amount = 1): ServingLog => ({ ...base, id: Math.random().toString(), date, dietGroupKey: key, amount, loggedAt: 0 })
const empty = (): WeekInput => ({ sessions: [], planned: [], servings: [], sleepLogs: [], checklist: [], caffeine: [] })
const END_OF_WEEK = at('2026-11-09', '10:00') // the Monday after, so Nov 2–8 is a full past week

describe('MIND score', () => {
  it('scores a strong week near the top, out of 14 without wine', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
    const s: ServingLog[] = [
      ...days.flatMap((d) => [sv('other_veg', d), sv('whole_grains', d, 3), sv('olive_oil', d)]),
      ...Array.from({ length: 6 }, () => sv('leafy_greens', '2026-11-03')),
      sv('berries', '2026-11-02', 2), sv('nuts', '2026-11-04', 5), sv('fish', '2026-11-05'), sv('beans', '2026-11-06', 4), sv('poultry', '2026-11-07', 2),
      sv('red_meat', '2026-11-03', 2), sv('sweets', '2026-11-04', 2),
    ]
    const m = mindScore(P.dietGroups, s, 7, false)
    expect(m.max).toBe(14)
    expect(m.score).toBe(14)
  })
  it('gives half points in the middle bands', () => {
    const s = [sv('leafy_greens', '2026-11-02', 3), sv('cheese', '2026-11-02', 2), sv('red_meat', '2026-11-02', 5), sv('butter', '2026-11-02', 7)]
    const g = Object.fromEntries(mindScore(P.dietGroups, s, 7, false).groups.map((x) => [x.key, x.points]))
    expect(g).toMatchObject({ leafy_greens: 0.5, cheese: 0.5, red_meat: 0.5, butter: 0.5, fish: 0, fried: 1 })
  })
  it('never rewards more than one glass of wine a day', () => {
    const one = mindScore(P.dietGroups, ['02', '03', '04', '05', '06', '07', '08'].map((d) => sv('wine', `2026-11-${d}`)), 7, true)
    expect(one.groups.find((g) => g.key === 'wine')!.points).toBe(1)
    const two = mindScore(P.dietGroups, [sv('wine', '2026-11-02', 2)], 7, true)
    expect(two.groups.find((g) => g.key === 'wine')!.points).toBe(0)
    expect(two.max).toBe(15)
  })
})

describe('weekly summary', () => {
  it('totals exercise, cardio, sleep and late caffeine for a past week', () => {
    const input = empty()
    const sess = (o: Partial<SessionLog>): SessionLog => ({ ...base, id: Math.random().toString(), date: '2026-11-03', activityType: 'pickleball', startAt: at('2026-11-03', '10:00'), durationMin: 120, intensity: 'moderate', status: 'done', protocolVersion: 1, ...o })
    input.sessions = [sess({}), sess({ activityType: 'mtb', date: '2026-11-08', startAt: at('2026-11-08', '09:00'), durationMin: 45, intensity: 'vigorous' })]
    input.planned = [{ ...base, id: 'r', weekStart: '2026-11-02', date: '2026-11-08', activityType: 'rest', slot: 'am', origin: 'template' }]
    const night = (n: string, q: SleepLog['quality']): SleepLog => ({ ...base, id: n, night: n, bedAt: at(n, '22:30'), wakeAt: at(n, '22:30') + 8 * 3600_000, quality: q })
    input.sleepLogs = [night('2026-11-02', 4), night('2026-11-03', 2)]
    const coffee = (d: string, hm: string): CaffeineLog => ({ ...base, id: d + hm, date: d, at: at(d, hm), drinkKey: 'x', label: 'Espresso', mg: 63 })
    input.caffeine = [coffee('2026-11-03', '09:00'), coffee('2026-11-03', '15:00'), coffee('2026-11-04', '16:00')]
    const w = summarizeWeek('2026-11-02', input, profile, P, END_OF_WEEK)
    expect(w.isCurrent).toBe(false)
    expect(w.daysElapsed).toBe(7)
    expect(w.totals.cardioModerateEqMin).toBe(210)
    expect(w.restKept).toBe(false)
    expect(w.sleep).toMatchObject({ nightsLogged: 2, avgMin: 480, avgQuality: 3, lateCaffeineDays: 2 })
    expect(w.caffeine.avgMgPerDay).toBe(27)
  })
  it('suggests an earlier last drink after 3 late-caffeine days', () => {
    const input = empty()
    input.caffeine = ['02', '03', '04'].map((d) => ({ ...base, id: d, date: `2026-11-${d}`, at: at(`2026-11-${d}`, '15:00'), drinkKey: 'cola', label: 'Cola', mg: 34 }))
    const w = summarizeWeek('2026-11-02', input, profile, P, END_OF_WEEK)
    const s = suggestions(w, [], input, profile, P)
    expect(s.map((x) => x.ruleKey)).toContain('late_caffeine')
    expect(s.find((x) => x.ruleKey === 'late_caffeine')!.body).toContain('usually cola')
  })
})
