import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { BrainHealthDB } from '../db'
import { ensureSeed, ensureWeek, logSession, movePlanned, sessionsInRange, skipPlanned } from '../repo'
import { plannedStatus } from '../../domain/plan'

describe('repo', () => {
  it('seeds once and generates a week once', async () => {
    const d = new BrainHealthDB('t1')
    await ensureSeed(d); await ensureSeed(d)
    expect(await d.protocols.count()).toBe(1)
    expect(await d.drinkPresets.count()).toBe(7)
    const ws = await ensureWeek('2026-11-05', d)
    await ensureWeek('2026-11-06', d)
    expect(ws).toBe('2026-11-02')
    expect(await d.plannedSessions.count()).toBe(8)
  })
  it('moves a session within the week and tracks status', async () => {
    const d = new BrainHealthDB('t2')
    await ensureSeed(d); await ensureWeek('2026-11-02', d)
    const mtb = (await d.plannedSessions.where('activityType').equals('mtb').first())!
    await movePlanned(mtb.id, '2026-11-08', d)
    const moved = (await d.plannedSessions.get(mtb.id))!
    expect(moved).toMatchObject({ date: '2026-11-08', origin: 'moved', movedFromDate: '2026-11-07' })
    await expect(movePlanned(mtb.id, '2026-11-10', d)).rejects.toThrow()
    await logSession({ date: '2026-11-08', activityType: 'mtb', startAt: 0, durationMin: 40, intensity: 'vigorous', plannedSessionId: mtb.id }, d)
    const logs = await sessionsInRange('2026-11-02', '2026-11-08', d)
    expect(plannedStatus(moved, logs)).toBe('done')
    const pb = (await d.plannedSessions.where('activityType').equals('pickleball').first())!
    await skipPlanned(pb, d)
    expect(plannedStatus(pb, await sessionsInRange('2026-11-02', '2026-11-08', d))).toBe('skipped')
  })
})

describe('custom activities', () => {
  it('adds a hike that counts toward cardio, survives removal, and revives on re-add', async () => {
    const { addCustomActivity, removeCustomActivity, logSession, sessionsInRange } = await import('../repo')
    const { weekTotals } = await import('../../domain/cardio')
    const { protocolV1 } = await import('../../domain/protocol.v1')
    const d = new BrainHealthDB('t3')
    await ensureSeed(d)
    const key = await addCustomActivity({ label: '  Hike ', defaultIntensity: 'moderate', isCardio: true }, d)
    expect(key).toBe('custom_hike')
    await logSession({ date: '2026-11-03', activityType: key, startAt: 0, durationMin: 120, intensity: 'moderate' }, d)
    const types = [...protocolV1.activityTypes, ...(await d.customActivities.toArray())]
    const t = weekTotals(await sessionsInRange('2026-11-02', '2026-11-08', d), types)
    expect(t.cardioModerateEqMin).toBe(120)
    expect(t.sessionsByType[key]).toBe(1)
    await removeCustomActivity(key, d)
    expect((await d.customActivities.get(key))!.deletedAt).toBeDefined()
    await addCustomActivity({ label: 'hike', defaultIntensity: 'vigorous', isCardio: true }, d)
    expect((await d.customActivities.get(key))!.deletedAt).toBeUndefined()
  })
})

describe('sleep and caffeine storage', () => {
  it('upserts one sleep log per night and one checklist row per item', async () => {
    const { saveSleepLog, setChecklistItem, logCaffeine, updateCaffeine } = await import('../repo')
    const d = new BrainHealthDB('t4')
    await ensureSeed(d)
    await saveSleepLog({ night: '2026-11-03', bedAt: 1, wakeAt: 2, quality: 3 }, d)
    await saveSleepLog({ night: '2026-11-03', bedAt: 1, wakeAt: 3, quality: 5 }, d)
    expect(await d.sleepLogs.count()).toBe(1)
    expect((await d.sleepLogs.toArray())[0].quality).toBe(5)
    await setChecklistItem('2026-11-03', 'dark', true, d)
    await setChecklistItem('2026-11-03', 'dark', false, d)
    expect(await d.checklistLogs.count()).toBe(1)
    const at = new Date('2026-11-03T23:50:00').getTime()
    const id = await logCaffeine({ key: 'espresso', label: 'Espresso', defaultMg: 63 }, at, d)
    await updateCaffeine(id, { at: new Date('2026-11-04T00:10:00').getTime() }, d)
    expect((await d.caffeineLogs.get(id))!.date).toBe('2026-11-04')
  })
})
