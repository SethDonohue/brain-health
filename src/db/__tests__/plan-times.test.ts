import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { BrainHealthDB } from '../db'
import { addPlanned, alive, ensureSeed, ensureWeek, getProfile, repeatLastWeek, saveUsualWeek, setPlannedTime } from '../repo'
import { formatTimeRange } from '../../domain/dates'
import { byTime } from '../../domain/plan'

const week = async (d: BrainHealthDB, ws: string) => alive(await d.plannedSessions.where('weekStart').equals(ws).toArray())

describe('time ranges', () => {
  it('formats start and length compactly', () => {
    expect(formatTimeRange('15:00', 120)).toBe('3–5 PM')
    expect(formatTimeRange('15:30', 90)).toBe('3:30–5 PM')
    expect(formatTimeRange('11:00', 90)).toBe('11 AM–12:30 PM')
    expect(formatTimeRange('07:00')).toBe('7 AM')
    expect(formatTimeRange('23:00', 120)).toBe('11 PM–1 AM')
  })

  it('sorts timed sessions first, earliest first, then morning before afternoon', () => {
    const items = [
      { id: 'pm', slot: 'pm' as const },
      { id: 't17', slot: 'pm' as const, startTime: '17:00' },
      { id: 'am', slot: 'am' as const },
      { id: 't09', slot: 'am' as const, startTime: '09:00' },
    ]
    expect(items.sort(byTime).map((i) => i.id)).toEqual(['t09', 't17', 'am', 'pm'])
  })
})

describe('setting plan times', () => {
  it('sets, changes and clears a time; repeat keeps it, the usual week does not', async () => {
    const d = new BrainHealthDB('t1')
    await ensureSeed(d)
    await ensureWeek('2026-11-02', d)
    const pb = (await week(d, '2026-11-02')).find((p) => p.activityType === 'pickleball')!

    await setPlannedTime(pb.id, { startTime: '09:30', durationMin: 120 }, d)
    expect(await d.plannedSessions.get(pb.id)).toMatchObject({ startTime: '09:30', durationMin: 120, slot: 'am' })
    await setPlannedTime(pb.id, { startTime: '15:00' }, d)
    const changed = (await d.plannedSessions.get(pb.id))!
    expect(changed).toMatchObject({ startTime: '15:00', slot: 'pm' })
    expect(changed.durationMin).toBeUndefined()
    await setPlannedTime(pb.id, { startTime: '15:00', durationMin: 120 }, d)

    await addPlanned('2026-11-02', '2026-11-05', 'mtb', 'am', d, { startTime: '18:00', durationMin: 90 })
    expect((await week(d, '2026-11-02')).find((p) => p.activityType === 'mtb' && p.origin === 'added')).toMatchObject({ startTime: '18:00', durationMin: 90, slot: 'pm' })

    await ensureWeek('2026-11-09', d)
    await repeatLastWeek('2026-11-09', d)
    const copied = (await week(d, '2026-11-09')).filter((p) => p.startTime)
    expect(copied.map((p) => [p.date, p.startTime, p.durationMin]).sort()).toEqual([
      [pb.date.replace(/\d\d$/, (x) => String(Number(x) + 7).padStart(2, '0')), '15:00', 120],
      ['2026-11-12', '18:00', 90],
    ].sort())

    await saveUsualWeek('2026-11-02', d)
    expect((await getProfile(d)).usualWeek!.every((u) => !u.startTime && !u.durationMin)).toBe(true)
    await ensureWeek('2026-11-23', d)
    expect((await week(d, '2026-11-23')).every((p) => !p.startTime)).toBe(true)

    await setPlannedTime(pb.id, null, d)
    const cleared = (await d.plannedSessions.get(pb.id))!
    expect(cleared.startTime).toBeUndefined()
    expect(cleared.durationMin).toBeUndefined()
    expect(cleared.slot).toBe('pm')
  })
})
