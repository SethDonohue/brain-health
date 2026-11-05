import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { alive } from '../repo'
import { BrainHealthDB } from '../db'
import {
  applyImportedSessions,
  currentProtocol,
  ensureSeed,
  ensureWeek,
  getProfile,
  logSession,
  movePlanned,
  repeatLastWeek,
  resetWeekToUsual,
  saveMealTemplates,
  saveUsualWeek,
  undoPlanChange,
} from '../repo'

const week = async (d: BrainHealthDB, ws: string) => alive(await d.plannedSessions.where('weekStart').equals(ws).toArray())

describe('repeat last week and usual week', () => {
  it('copies last week, keeps done sessions, and undoes exactly', async () => {
    const d = new BrainHealthDB('p1')
    await ensureSeed(d)
    await ensureWeek('2026-11-02', d)
    const mtb = (await week(d, '2026-11-02')).find((p) => p.activityType === 'mtb')!
    await movePlanned(mtb.id, '2026-11-08', d)
    await ensureWeek('2026-11-09', d)
    const pb = (await week(d, '2026-11-09')).find((p) => p.activityType === 'pickleball')!
    await logSession({ date: pb.date, activityType: 'pickleball', startAt: 0, durationMin: 90, intensity: 'moderate', plannedSessionId: pb.id }, d)
    const before = await week(d, '2026-11-09')

    const change = (await repeatLastWeek('2026-11-09', d))!
    const after = await week(d, '2026-11-09')
    expect(after.some((p) => p.id === pb.id)).toBe(true) // done session kept
    expect(after.find((p) => p.activityType === 'mtb' && p.id !== mtb.id)?.date).toBe('2026-11-15') // moved day carried over
    expect(after.length).toBe(9) // 7 open sessions replaced by 8 copies, plus the kept done one

    await undoPlanChange(change, d)
    const undone = await week(d, '2026-11-09')
    expect(undone.map((p) => p.id).sort()).toEqual(before.map((p) => p.id).sort())
    expect(await repeatLastWeek('2026-11-30', d)).toBeNull()
  })

  it('new weeks start from the saved usual week', async () => {
    const d = new BrainHealthDB('p2')
    await ensureSeed(d)
    await ensureWeek('2026-11-02', d)
    const mtb = (await week(d, '2026-11-02')).find((p) => p.activityType === 'mtb')!
    await movePlanned(mtb.id, '2026-11-04', d)
    expect(await saveUsualWeek('2026-11-02', d)).toBe(8)
    expect((await getProfile(d)).usualWeek?.find((u) => u.activityType === 'mtb')?.weekday).toBe(3)
    await ensureWeek('2026-11-16', d)
    expect((await week(d, '2026-11-16')).find((p) => p.activityType === 'mtb')?.date).toBe('2026-11-18')
    const ch = await resetWeekToUsual('2026-11-02', d)
    expect(ch.added.length).toBe(8)
  })
})

describe('imported sessions', () => {
  // the booking screenshot: Tue, Wed, Thu 3-5 PM Happy Hour Open Play
  const bookings = ['2026-11-10', '2026-11-11', '2026-11-12'].map((date) => ({
    date,
    activityType: 'pickleball' as const,
    startTime: '15:00',
    durationMin: 120,
    note: 'Happy Hour Open Play 4.0+',
  }))

  it('moves planned pickleball onto booked days instead of adding extras, then skips repeats', async () => {
    const d = new BrainHealthDB('i1')
    await ensureSeed(d)
    const target = (await currentProtocol(d)).weeklyTargets.find((t) => t.activityType === 'pickleball')!.timesPerWeek
    const { outcomes, change } = await applyImportedSessions(bookings, d)
    expect(outcomes).toHaveLength(3)
    expect(outcomes).not.toContain('duplicate')
    const pb = (await week(d, '2026-11-09')).filter((p) => p.activityType === 'pickleball')
    expect(pb.length).toBe(Math.max(target, 3))
    for (const b of bookings) {
      const row = pb.find((p) => p.date === b.date)!
      expect(row).toMatchObject({ startTime: '15:00', durationMin: 120, note: 'Happy Hour Open Play 4.0+', imported: true, slot: 'pm' })
    }
    // the same screenshot again changes nothing
    const again = await applyImportedSessions(bookings, d)
    expect(again.outcomes).toEqual(['duplicate', 'duplicate', 'duplicate'])
    // undo puts the week back
    await undoPlanChange(change, d)
    expect((await week(d, '2026-11-09')).filter((p) => p.imported)).toHaveLength(0)
  })
})

describe('usual meals', () => {
  it('saves meals as a new protocol version', async () => {
    const d = new BrainHealthDB('m1')
    await ensureSeed(d)
    const cur = await currentProtocol(d)
    const v = await saveMealTemplates([...cur.mealTemplates, { key: 'meal_x', label: 'Lentil soup', servings: [{ dietGroupKey: 'beans', amount: 1 }] }], d)
    expect(v).toBe(cur.version + 1)
    expect((await currentProtocol(d)).mealTemplates.at(-1)?.label).toBe('Lentil soup')
  })
})
