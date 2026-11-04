import { describe, expect, it } from 'vitest'
import { groupProgress, limitStatus, targetText } from '../mind'
import { hitTop, historyFor, prefill, targetLabel } from '../strength'
import { protocolV1 } from '../protocol.v1'
import type { ServingLog, SessionLog, SetLog } from '../types'
import { KG_PER_LB } from '../units'

const g = (k: string) => protocolV1.dietGroups.find((x) => x.key === k)!
const sv = (key: string, amount = 1, date = '2026-11-04'): ServingLog => ({ id: Math.random().toString(), createdAt: 0, updatedAt: 0, date, dietGroupKey: key, amount, loggedAt: 0 })

describe('MIND progress', () => {
  it('counts weekly groups over the week and daily groups today', () => {
    const week = [sv('leafy_greens', 1, '2026-11-02'), sv('leafy_greens'), sv('other_veg', 1, '2026-11-02')]
    const today = week.filter((l) => l.date === '2026-11-04')
    expect(groupProgress(g('leafy_greens'), today, week)).toMatchObject({ value: 2, status: 'partial' })
    expect(groupProgress(g('other_veg'), today, week)).toMatchObject({ value: 0, week: 1, status: 'none' })
  })
  it('turns limits amber at 75% and red at the cap', () => {
    expect(limitStatus(2, 3)).toBe('ok')
    expect(limitStatus(2.25, 3)).toBe('near')
    expect(limitStatus(3, 3)).toBe('cap')
    expect(groupProgress(g('cheese'), [], [sv('cheese')]).status).toBe('cap')
  })
  it('flags wine above one glass', () => {
    const t = [sv('wine'), sv('wine')]
    expect(groupProgress(g('wine'), t, t).status).toBe('over')
  })
  it('describes targets', () => {
    expect(targetText(g('red_meat'))).toBe('under 3 a week')
    expect(targetText(g('butter'))).toBe('under 1 tbsp a day')
    expect(targetText(g('whole_grains'))).toBe('3 a day')
  })
})

describe('strength', () => {
  const legs = protocolV1.workout.exercises[0]
  const press = legs.variants[0]
  const sess = (id: string, startAt: number): SessionLog => ({ id, createdAt: 0, updatedAt: 0, date: '2026-11-03', activityType: 'strength', startAt, durationMin: 50, intensity: 'moderate', status: 'done', protocolVersion: 1 })
  const set = (sessionId: string, i: number, kg: number, reps: number): SetLog => ({ id: `${sessionId}${i}`, createdAt: 0, updatedAt: 0, sessionId, exerciseKey: 'legs', variant: 'leg_press', setIndex: i, weightKg: kg, reps })
  it('orders history newest first and prefills last weights', () => {
    const h = historyFor('legs', 'leg_press', [set('a', 0, 80, 10), set('b', 0, 90, 9), set('b', 1, 90, 8)], [sess('a', 1), sess('b', 2)])
    expect(h.map((x) => x.session.id)).toEqual(['b', 'a'])
    const p = prefill(legs, press, h, 'metric')
    expect(p.sets).toHaveLength(3)
    expect(p.sets[2]).toEqual({ weightKg: 90, reps: 8, holdSec: undefined })
    expect(p.suggestIncrease).toBeUndefined()
  })
  it('suggests +5 lb when every set hit 12', () => {
    const h = historyFor('legs', 'leg_press', [0, 1, 2].map((i) => set('c', i, 100 * KG_PER_LB, 12)), [sess('c', 3)])
    expect(hitTop(press, h[0].sets)).toBe(true)
    const p = prefill(legs, press, h, 'imperial')
    expect(p.suggestIncrease!.toKg / KG_PER_LB).toBeCloseTo(105)
    expect(p.sets[0].reps).toBe(8)
  })
  it('labels targets', () => {
    expect(targetLabel(legs, press)).toBe('3 × 8–12')
    const core = protocolV1.workout.exercises[4]
    expect(targetLabel(core, core.variants[0])).toBe('3 × 45–60 s')
  })
})

describe('MIND study bands', async () => {
  const { MIND_BANDS, bandPoints, bandZones, bandText, trackMax } = await import('../mind')
  it('scores at the published cut-offs', () => {
    expect([2, 3, 5, 6].map((v) => bandPoints(MIND_BANDS.leafy_greens, v))).toEqual([0, 0.5, 0.5, 1])
    expect([3, 4, 6, 7].map((v) => bandPoints(MIND_BANDS.red_meat, v))).toEqual([1, 0.5, 0.5, 0])
    expect([0.5, 1, 2, 2.5].map((v) => bandPoints(MIND_BANDS.butter, v))).toEqual([1, 0.5, 0.5, 0])
  })
  it('lays zones end to end on the track', () => {
    expect(bandZones(MIND_BANDS.red_meat, 10)).toEqual([
      { from: 0, to: 4, points: 1 },
      { from: 4, to: 7, points: 0.5 },
      { from: 7, to: 10, points: 0 },
    ])
    expect(bandZones(MIND_BANDS.butter, 4, 0.5).map((z) => z.to)).toEqual([1, 2.5, 4])
    expect(bandZones(MIND_BANDS.fish, 3).map((z) => z.points)).toEqual([0, 1])
  })
  it('leaves room for the target and the value', () => {
    expect(trackMax(MIND_BANDS.leafy_greens, 10, 2)).toBe(12)
    expect(trackMax(MIND_BANDS.leafy_greens, 6, 20)).toBeCloseTo(21.6)
  })
  it('describes the full-point cut-off', () => {
    expect(bandText(MIND_BANDS.leafy_greens, 'serving')).toBe('full point at 6+ a week')
    expect(bandText(MIND_BANDS.butter, 'tbsp')).toBe('full point under 1 tbsp a day')
    expect(MIND_BANDS.wine).toBeUndefined()
  })
})
