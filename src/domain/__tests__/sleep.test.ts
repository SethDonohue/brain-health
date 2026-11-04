import { describe, expect, it } from 'vitest'
import { currentNight, lastNight, moveTab, nightFlags, nightTimes, normalizeTabOrder } from '../sleep'
import { protocolV1 } from '../protocol.v1'
import type { CaffeineLog, SessionLog } from '../types'

const at = (d: string, hm: string) => new Date(`${d}T${hm}:00`).getTime()
const profile = { bedtimeDefault: '22:30', bedtimeByWeekday: {} }

describe('nights', () => {
  it('rolls over at 4 am', () => {
    expect(currentNight(at('2026-11-05', '01:30'))).toBe('2026-11-04')
    expect(currentNight(at('2026-11-05', '08:00'))).toBe('2026-11-05')
    expect(lastNight(at('2026-11-05', '08:00'))).toBe('2026-11-04')
  })
  it('places bed after midnight and wake the next morning', () => {
    const a = nightTimes('2026-11-04', '22:45', '06:50')
    expect(new Date(a.bedAt).getDate()).toBe(4)
    expect((a.wakeAt - a.bedAt) / 60000).toBe(8 * 60 + 5)
    const b = nightTimes('2026-11-04', '00:30', '07:00')
    expect(new Date(b.bedAt).getDate()).toBe(5)
    expect((b.wakeAt - b.bedAt) / 60000).toBe(390)
  })
})

describe('night flags', () => {
  const base = { createdAt: 0, updatedAt: 0 }
  const coffee = (hm: string): CaffeineLog => ({ ...base, id: hm, date: '2026-11-04', at: at('2026-11-04', hm), drinkKey: 'espresso', label: 'Espresso', mg: 63 })
  const sess = (o: Partial<SessionLog>): SessionLog => ({ ...base, id: Math.random().toString(), date: '2026-11-04', activityType: 'pickleball', startAt: at('2026-11-04', '10:00'), durationMin: 120, intensity: 'moderate', status: 'done', protocolVersion: 1, ...o })
  it('flags caffeine after 12:30 and hard sessions ending after 18:30', () => {
    const f = nightFlags('2026-11-04', profile, protocolV1.sleepRules, [coffee('09:00'), coffee('14:10')], [
      sess({}),
      sess({ activityType: 'strength', startAt: at('2026-11-04', '17:45'), durationMin: 60 }),
      sess({ activityType: 'bike_commute', startAt: at('2026-11-04', '18:20'), durationMin: 20 }),
      sess({ activityType: 'custom_hike', startAt: at('2026-11-04', '18:00'), durationMin: 60, intensity: 'vigorous' }),
    ], protocolV1.activityTypes)
    expect(f.lateCaffeine.map((c) => c.id)).toEqual(['14:10'])
    expect(f.lateSessions.map((s) => s.activityType)).toEqual(['strength', 'custom_hike'])
  })
})

describe('tab order', () => {
  it('defaults to today, sleep, eat, train, week', () => {
    expect(normalizeTabOrder(undefined)).toEqual(['today', 'sleep', 'eat', 'train', 'week'])
  })
  it('keeps a saved order and appends missing tabs', () => {
    expect(normalizeTabOrder(['eat', 'today'])).toEqual(['eat', 'today', 'sleep', 'train', 'week'])
  })
  it('moves a tab and ignores moves past the ends', () => {
    expect(moveTab(['today', 'sleep', 'eat'], 'eat', -1)).toEqual(['today', 'eat', 'sleep'])
    expect(moveTab(['today', 'sleep'], 'today', -1)).toEqual(['today', 'sleep'])
  })
})
