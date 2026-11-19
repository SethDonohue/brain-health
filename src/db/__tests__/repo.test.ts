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
    expect(await d.plannedSessions.count()).toBe(7) // pickleball 3, strength 2, MTB 1 (an on week), rest 1
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
    const id = await startStrength(undefined, undefined, d)
    expect(await startStrength(undefined, undefined, d)).toBe(id)
    expect((await d.sessionLogs.get(id))!.workoutDay).toBe('A') // first workout is A
    await saveSet(id, 'a_split_squat', 'split_squat', 0, { reps: 10 }, d)
    await saveSet(id, 'a_split_squat', 'bulgarian', 0, { reps: 12 }, d)
    expect(await d.setLogs.count()).toBe(1)
    await finishStrength(id, { durationMin: 50, intensity: 'moderate' }, d)
    expect(await activeStrength(d)).toBeUndefined()
    expect((await d.sessionLogs.get(id))!.plannedSessionId).toBeDefined()
    // the next workout alternates to B
    const next = await startStrength(undefined, undefined, d)
    expect((await d.sessionLogs.get(next))!.workoutDay).toBe('B')
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

describe('app updates', () => {
  it('moves an existing phone to the home A/B workouts and new targets once', async () => {
    const { protocolV1 } = await import('../../domain/protocol.v1')
    const { currentProtocol, defaultProfile } = await import('../repo')
    const { todayKey, weekStartOf } = await import('../../domain/dates')
    const d = new BrainHealthDB('u1')
    // a phone from v0.7.0: gym workout, pickleball 4 a week, weekly MTB, a custom diet target
    const { everyWeeks: _e, anchorWeek: _a, ...weeklyMtb } = protocolV1.weeklyTargets.find((t) => t.activityType === 'mtb')!
    const old = {
      ...structuredClone(protocolV1),
      version: 3,
      dietGroups: protocolV1.dietGroups.map((g) => (g.key === 'nuts' ? { ...g, target: 7 } : g)),
      weeklyTargets: protocolV1.weeklyTargets.map((t) =>
        t.activityType === 'pickleball' ? { ...t, timesPerWeek: 4, defaultDays: [1, 2, 4, 5] as never } : t.activityType === 'mtb' ? weeklyMtb : t.activityType === 'strength' ? { ...t, durationMin: 45 } : t,
      ),
      workout: { sessionTargetMin: [45, 60] as [number, number], exercises: [{ key: 'legs', name: 'Legs', targetSets: 3, variants: [{ key: 'leg_press', name: 'Leg press', target: { kind: 'reps' as const, min: 8, max: 12 }, weighted: true }], cue: '', muscleGroups: ['quads'] }] },
    }
    await d.protocols.put(old)
    const { appliedUpdates: _u, ...oldProfile } = defaultProfile()
    await d.profile.put(oldProfile)

    await ensureSeed(d)
    const cur = await currentProtocol(d)
    expect(cur.version).toBe(4)
    expect(cur.workout.days?.map((x) => x.key)).toEqual(['A', 'B'])
    expect(cur.workout.exercises).toHaveLength(16)
    expect(cur.workout.sessionTargetMin).toEqual([50, 60])
    const t = (k: string) => cur.weeklyTargets.find((x) => x.activityType === k)!
    expect(t('pickleball')).toMatchObject({ timesPerWeek: 3, defaultDays: [1, 3, 4] })
    expect(t('strength')).toMatchObject({ durationMin: 50, durationMax: 60 })
    expect(t('mtb')).toMatchObject({ timesPerWeek: 1, everyWeeks: 2, anchorWeek: weekStartOf(todayKey()) })
    expect(cur.dietGroups.find((g) => g.key === 'nuts')!.target).toBe(7) // other edits kept

    await ensureSeed(d)
    expect((await currentProtocol(d)).version).toBe(4) // only once
  })
})

describe('cardio targets 300 / 600 (v0.11.0)', () => {
  it('new phones start at 300 / 600', async () => {
    const { getProfile } = await import('../repo')
    const d = new BrainHealthDB('cardio-new')
    await ensureSeed(d)
    expect(await getProfile(d)).toMatchObject({ cardioFloorMin: 300, cardioTargetMin: 600 })
  })
  it('an existing phone at 150 / 300 is moved once, and later edits stay', async () => {
    const { defaultProfile, getProfile, updateProfile } = await import('../repo')
    const d = new BrainHealthDB('cardio-old')
    await ensureSeed(d)
    await d.profile.put({ ...defaultProfile(), cardioFloorMin: 150, cardioTargetMin: 300, appliedUpdates: ['home_strength_ab'] })
    await ensureSeed(d)
    expect(await getProfile(d)).toMatchObject({ cardioFloorMin: 300, cardioTargetMin: 600 })
    await updateProfile({ cardioFloorMin: 240, cardioTargetMin: 480 }, d)
    await ensureSeed(d)
    expect(await getProfile(d)).toMatchObject({ cardioFloorMin: 240, cardioTargetMin: 480 })
  })
})

describe('mountain bike rides in two parts', () => {
  const part = (min: number, intensity: 'light' | 'moderate' | 'vigorous', rpe?: number) => ({ min, intensity, ...(rpe != null ? { rpe } : {}) })

  it('one split ride is one session; each part counts by its own intensity', async () => {
    const { weekTotals } = await import('../../domain/cardio')
    const { protocolV1 } = await import('../../domain/protocol.v1')
    const d = new BrainHealthDB('mtb-parts')
    await ensureSeed(d)
    await logSession({ date: '2026-11-07', activityType: 'mtb', startAt: 1, durationMin: 75, intensity: 'vigorous', parts: { climb: part(45, 'vigorous', 8), descent: part(30, 'vigorous', 6) } }, d)
    const logs = await sessionsInRange('2026-11-02', '2026-11-08', d)
    const t = weekTotals(logs, protocolV1.activityTypes)
    expect(t.sessionsByType.mtb).toBe(1)
    expect(t.totalExerciseMin).toBe(75)
    expect(t.vigorousMin).toBe(75)
    expect(t.cardioModerateEqMin).toBe(150)
    // an easier descent counts as moderate
    const easier = weekTotals([{ ...logs[0], parts: { climb: part(45, 'vigorous'), descent: part(30, 'moderate') } }], protocolV1.activityTypes)
    expect(easier).toMatchObject({ vigorousMin: 45, moderateMin: 30, cardioModerateEqMin: 120 })
  })

  it('old rides without parts count exactly as before and the parts survive a backup', async () => {
    const { weekTotals, ridePartsText } = await import('../../domain/cardio')
    const { protocolV1 } = await import('../../domain/protocol.v1')
    const { buildBackup, restoreBackup, sessionsCsv } = await import('../backup')
    const d = new BrainHealthDB('mtb-backup')
    await ensureSeed(d)
    await logSession({ date: '2026-11-07', activityType: 'mtb', startAt: 1, durationMin: 40, intensity: 'vigorous' }, d)
    await logSession({ date: '2026-11-08', activityType: 'mtb', startAt: 2, durationMin: 75, intensity: 'vigorous', parts: { climb: part(45, 'vigorous', 8), descent: part(30, 'vigorous', 6) } }, d)
    const logs = await sessionsInRange('2026-11-02', '2026-11-08', d)
    expect(weekTotals([logs[0]], protocolV1.activityTypes).cardioModerateEqMin).toBe(80)
    expect(ridePartsText(logs[0], (m) => `${m} min`)).toBeUndefined()
    expect(ridePartsText(logs[1], (m) => `${m} min`)).toBe('45 min up, 30 min down')

    const backup = JSON.parse(JSON.stringify(await buildBackup(d)))
    const d2 = new BrainHealthDB('mtb-backup-2')
    await restoreBackup(backup, d2)
    const restored = await sessionsInRange('2026-11-02', '2026-11-08', d2)
    expect(restored[1].parts).toEqual({ climb: part(45, 'vigorous', 8), descent: part(30, 'vigorous', 6) })
    expect(restored[0].parts).toBeUndefined()

    const csv = sessionsCsv(restored, protocolV1.activityTypes).split('\n')
    expect(csv[0].endsWith('climb_min,descent_min')).toBe(true)
    expect(csv[2].endsWith(',45,30')).toBe(true)
  })
})
