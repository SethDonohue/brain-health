import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { BrainHealthDB } from '../db'
import { alive, currentProtocol, dropProtocolVersion, ensureSeed, ensureWeek, saveWeeklyTargets, seedWeeklyTargets } from '../repo'
import { generateWeek, protocolForWeek, targetProgress } from '../../domain/plan'
import { protocolV1 } from '../../domain/protocol.v1'
import { suggestions, summarizeWeek, type WeekInput } from '../../domain/weekly'
import type { WeeklyTarget } from '../../domain/types'
import { todayKey, weekStartOf } from '../../domain/dates'

const pickleball = (p: { weeklyTargets: WeeklyTarget[] }) => p.weeklyTargets.find((t) => t.activityType === 'pickleball')!

describe('weekly targets', () => {
  it('saves times and length as a new version, undo and reset work', async () => {
    const d = new BrainHealthDB('wt1')
    await ensureSeed(d)
    const v = await saveWeeklyTargets({ pickleball: { timesPerWeek: 4, durationMin: 90, durationMax: 120 } }, d)
    const cur = await currentProtocol(d)
    expect(cur.version).toBe(v)
    expect(pickleball(cur)).toMatchObject({ timesPerWeek: 4, durationMin: 90, durationMax: 120 })
    // others untouched
    expect(cur.weeklyTargets.find((t) => t.activityType === 'strength')).toEqual(protocolV1.weeklyTargets.find((t) => t.activityType === 'strength'))
    await dropProtocolVersion(v, d)
    expect(pickleball(await currentProtocol(d)).timesPerWeek).toBe(3)
    await saveWeeklyTargets({ pickleball: { timesPerWeek: 2, durationMin: 60, durationMax: 60 } }, d)
    await saveWeeklyTargets(seedWeeklyTargets(), d)
    expect(pickleball(await currentProtocol(d))).toMatchObject({ timesPerWeek: 3, durationMin: 120, durationMax: 180 })
  })

  it('new weeks follow a lowered or raised target, extra sessions on free days', async () => {
    const lower = generateWeek('2026-11-16', protocolV1.weeklyTargets.map((t) => (t.activityType === 'pickleball' ? { ...t, timesPerWeek: 2 } : t)), 7)
    expect(lower.filter((p) => p.activityType === 'pickleball')).toHaveLength(2)
    const higher = generateWeek('2026-11-16', protocolV1.weeklyTargets.map((t) => (t.activityType === 'pickleball' ? { ...t, timesPerWeek: 5 } : t)), 7)
    const pb = higher.filter((p) => p.activityType === 'pickleball').map((p) => p.date)
    expect(pb).toHaveLength(5)
    expect(new Set(pb).size).toBe(5)
    expect(pb).not.toContain('2026-11-22') // Sunday rest day stays free
    const none = generateWeek('2026-11-16', protocolV1.weeklyTargets.map((t) => (t.activityType === 'mtb' ? { ...t, timesPerWeek: 0 } : t)), 7)
    expect(none.some((p) => p.activityType === 'mtb')).toBe(false)
    expect(targetProgress(none.length ? protocolV1.weeklyTargets.map((t) => (t.activityType === 'mtb' ? { ...t, timesPerWeek: 0 } : t)) : [], '2026-11-16', [], []).map((x) => x.activityType)).not.toContain('mtb')

    const d = new BrainHealthDB('wt2')
    await ensureSeed(d)
    await saveWeeklyTargets({ pickleball: { timesPerWeek: 2, durationMin: 120, durationMax: 180 } }, d)
    await ensureWeek('2026-12-07', d)
    expect(alive(await d.plannedSessions.where('weekStart').equals('2026-12-07').toArray()).filter((p) => p.activityType === 'pickleball')).toHaveLength(2)
  })

  it('judges each past week by the target in force then', () => {
    const v2 = { ...protocolV1, version: 2, effectiveFrom: '2026-11-18', weeklyTargets: protocolV1.weeklyTargets.map((t) => (t.activityType === 'pickleball' ? { ...t, timesPerWeek: 4 } : t)) }
    const versions = [v2, protocolV1]
    expect(protocolForWeek(versions, '2026-11-09')!.version).toBe(1)
    expect(protocolForWeek(versions, '2026-11-16')!.version).toBe(2) // saved mid-week: applies to that week
    expect(protocolForWeek(versions, '2026-10-26')!.version).toBe(1) // before any version: the first

    const play = (date: string) => ({ id: date, date, activityType: 'pickleball' as const, status: 'done' as const, durationMin: 120, intensity: 'moderate' as const, startAt: new Date(`${date}T10:00:00`).getTime(), protocolVersion: 1, createdAt: 0, updatedAt: 0 })
    const input: WeekInput = { sessions: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-17', '2026-11-18', '2026-11-19'].map(play) as never, planned: [], servings: [], sleepLogs: [], checklist: [], caffeine: [] }
    const profile = { restDay: 7, bedtimeDefault: '22:30', bedtimeByWeekday: {}, wakeDefault: '07:00', wineEnabled: false, units: 'imperial' } as never
    const end = new Date('2026-11-29T12:00:00').getTime()
    const sum = (ws: string) => summarizeWeek(ws, input, profile, protocolForWeek(versions, ws)!, end)
    expect(sum('2026-11-09').targets.find((t) => t.activityType === 'pickleball')).toMatchObject({ target: 3, done: 3 })
    expect(sum('2026-11-16').targets.find((t) => t.activityType === 'pickleball')).toMatchObject({ target: 4, done: 3 })
    // 3 of 3 then 3 of 4: not "missed two weeks running"
    const ideas = suggestions(sum('2026-11-23'), [sum('2026-11-16'), sum('2026-11-09')], input, profile, v2)
    expect(ideas.some((s) => s.id.includes('missed_pickleball'))).toBe(false)
  })

  it('plans and judges an every-other-week target only on its on weeks', async () => {
    const mtb = protocolV1.weeklyTargets.find((t) => t.activityType === 'mtb')!
    expect(mtb).toMatchObject({ everyWeeks: 2, anchorWeek: '2026-11-16' })
    const rides = (ws: string) => generateWeek(ws, protocolV1.weeklyTargets, 7).filter((p) => p.activityType === 'mtb').length
    expect(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'].map(rides)).toEqual([0, 1, 0, 1])
    expect(targetProgress(protocolV1.weeklyTargets, '2026-11-23', [], []).some((x) => x.activityType === 'mtb')).toBe(false)
    expect(targetProgress(protocolV1.weeklyTargets, '2026-11-30', [], []).find((x) => x.activityType === 'mtb')!.target).toBe(1)

    // switching on in Settings makes this week an on week; switching off clears it
    const d = new BrainHealthDB('wt3')
    await ensureSeed(d)
    await saveWeeklyTargets({ pickleball: { timesPerWeek: 3, durationMin: 120, durationMax: 180, everyWeeks: 2 } }, d)
    const on = pickleball(await currentProtocol(d))
    expect(on.everyWeeks).toBe(2)
    expect(on.anchorWeek).toBe(weekStartOf(todayKey()))
    await saveWeeklyTargets({ pickleball: { timesPerWeek: 3, durationMin: 120, durationMax: 180, everyWeeks: 1 } }, d)
    const off = pickleball(await currentProtocol(d))
    expect(off.everyWeeks).toBeUndefined()
    expect(off.anchorWeek).toBeUndefined()
    // an existing schedule keeps its weeks when other fields change
    await saveWeeklyTargets({ mtb: { timesPerWeek: 1, durationMin: 60, durationMax: 90, everyWeeks: 2 } }, d)
    expect((await currentProtocol(d)).weeklyTargets.find((t) => t.activityType === 'mtb')!.anchorWeek).toBe('2026-11-16')
  })
})
