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

describe('servings and strength storage', () => {
  it('undoes the latest serving and logs a whole meal', async () => {
    const { addServing, undoLastServing, logMeal, deleteServings } = await import('../repo')
    const { protocolV1 } = await import('../../domain/protocol.v1')
    const d = new BrainHealthDB('t5')
    await addServing('2026-11-04', 'nuts', 1, undefined, d)
    expect(await undoLastServing('2026-11-04', 'nuts', d)).toBe(true)
    expect(await undoLastServing('2026-11-04', 'nuts', d)).toBe(false)
    const ids = await logMeal('2026-11-04', protocolV1.mealTemplates[1], () => true, d)
    expect(ids).toHaveLength(6)
    await deleteServings(ids, d)
    expect((await d.servingLogs.toArray()).every((r) => r.deletedAt)).toBe(true)
  })
  it('keeps one active workout, upserts sets and links the planned session on finish', async () => {
    const { startStrength, saveSet, finishStrength, activeStrength } = await import('../repo')
    const d = new BrainHealthDB('t6')
    await ensureSeed(d)
    const { todayKey } = await import('../../domain/dates')
    await ensureWeek(todayKey(), d)
    await d.plannedSessions.add({ id: 'ps', createdAt: 0, updatedAt: 0, weekStart: '', date: todayKey(), activityType: 'strength', slot: 'pm', origin: 'added' })
    const id = await startStrength(undefined, d)
    expect(await startStrength(undefined, d)).toBe(id)
    await saveSet(id, 'legs', 'leg_press', 0, { weightKg: 80, reps: 10 }, d)
    await saveSet(id, 'legs', 'squat', 0, { weightKg: 60, reps: 12 }, d)
    expect(await d.setLogs.count()).toBe(1)
    await finishStrength(id, { durationMin: 50, intensity: 'moderate' }, d)
    expect(await activeStrength(d)).toBeUndefined()
    expect((await d.sessionLogs.get(id))!.plannedSessionId).toBeDefined()
  })
})

describe('backup', () => {
  it('round-trips every table losslessly', async () => {
    const { buildBackup, restoreBackup } = await import('../backup')
    const { logSession, addServing, saveSleepLog } = await import('../repo')
    const a = new BrainHealthDB('t7')
    await ensureSeed(a)
    await ensureWeek('2026-11-04', a)
    await logSession({ date: '2026-11-04', activityType: 'pickleball', startAt: 1, durationMin: 120, intensity: 'moderate' }, a)
    await addServing('2026-11-04', 'nuts', 1, undefined, a)
    await saveSleepLog({ night: '2026-11-03', bedAt: 1, wakeAt: 2, quality: 4 }, a)
    const backup = JSON.parse(JSON.stringify(await buildBackup(a)))
    const b = new BrainHealthDB('t8')
    await ensureSeed(b)
    await restoreBackup(backup, b)
    expect(JSON.parse(JSON.stringify(await buildBackup(b))).tables).toEqual(backup.tables)
    await expect(restoreBackup({ app: 'other' }, b)).rejects.toThrow()
  })
})

describe('editable diet targets', () => {
  it('saves a new protocol version, undoes it, and keeps v1', async () => {
    const { saveDietTargets, dropProtocolVersion, currentProtocol, seedDietTargets } = await import('../repo')
    const d = new BrainHealthDB('t9')
    await ensureSeed(d)
    const v = await saveDietTargets({ leafy_greens: 8, red_meat: 2 }, d)
    expect(v).toBe(2)
    const p = await currentProtocol(d)
    expect(p.dietGroups.find((g) => g.key === 'leafy_greens')!.target).toBe(8)
    expect(p.dietGroups.find((g) => g.key === 'nuts')!.target).toBe(5)
    await dropProtocolVersion(v, d)
    expect((await currentProtocol(d)).version).toBe(1)
    await dropProtocolVersion(1, d)
    expect(await d.protocols.count()).toBe(1)
    expect(seedDietTargets().leafy_greens).toBe(6)
  })
})
