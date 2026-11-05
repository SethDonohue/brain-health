import { ulid } from 'ulid'
import { addDaysKey, toDateKey, weekStartOf } from '../domain/dates'
import { generateWeek, slotOf, usualFromWeek, weekFromUsual } from '../domain/plan'
import { protocolV1, validateProtocol } from '../domain/protocol.v1'
import { DEFAULT_TAB_ORDER } from '../domain/types'
import type {
  ActivityKey,
  BaseRecord,
  CaffeineLog,
  CustomActivity,
  DrinkPreset,
  CustomActivityKey,
  Intensity,
  IsoWeekday,
  MealTemplate,
  PlannedSession,
  Profile,
  ProtocolVersion,
  ServingLog,
  SessionLog,
  SleepLog,
  Slot,
} from '../domain/types'
import { db, type BrainHealthDB } from './db'

const now = () => Date.now()
export const newRecord = (): BaseRecord => {
  const t = now()
  return { id: ulid(), createdAt: t, updatedAt: t }
}
export const alive = <T extends { deletedAt?: number }>(rows: T[]) => rows.filter((r) => !r.deletedAt)

export const defaultProfile = (): Profile => ({
  id: 'me',
  name: '',
  units: 'imperial',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City',
  bedtimeDefault: '22:30',
  bedtimeByWeekday: {},
  wakeDefault: '07:00',
  restDay: 7,
  cardioFloorMin: 150,
  cardioTargetMin: 300,
  commuteDefaultMin: 20,
  wineEnabled: false,
  restTimerSec: 90,
  noticeAcknowledged: false,
  onboarded: false,
  tabOrder: [...DEFAULT_TAB_ORDER],
  updatedAt: now(),
})

/** First-run seeding: profile, protocol v1, drink presets. Safe to call on every launch. */
export async function ensureSeed(d: BrainHealthDB = db): Promise<void> {
  await d.transaction('rw', [d.profile, d.protocols, d.drinkPresets], async () => {
    if (!(await d.profile.get('me'))) await d.profile.put(defaultProfile())
    if ((await d.protocols.count()) === 0) await d.protocols.put(validateProtocol(protocolV1))
    if ((await d.drinkPresets.count()) === 0) {
      await d.drinkPresets.bulkPut(
        protocolV1.drinkPresets.map((p, i) => ({ ...p, isCustom: false, sort: i })),
      )
    }
  })
}

export async function getProfile(d: BrainHealthDB = db): Promise<Profile> {
  return (await d.profile.get('me')) ?? defaultProfile()
}

export async function updateProfile(patch: Partial<Profile>, d: BrainHealthDB = db) {
  await d.profile.update('me', { ...patch, updatedAt: now() })
}

/** The protocol version in effect (the latest). */
export async function currentProtocol(d: BrainHealthDB = db): Promise<ProtocolVersion> {
  const p = await d.protocols.orderBy('version').last()
  return p ?? protocolV1
}

/** Make sure the week's planned sessions exist; generated once per week from the targets. */
export async function ensureWeek(dateKey: string, d: BrainHealthDB = db): Promise<string> {
  const weekStart = weekStartOf(dateKey)
  await d.transaction('rw', [d.plannedSessions, d.protocols, d.profile], async () => {
    const existing = await d.plannedSessions.where('weekStart').equals(weekStart).count()
    if (existing > 0) return
    const [protocol, profile] = await Promise.all([currentProtocol(d), getProfile(d)])
    const drafts = profile.usualWeek?.length ? weekFromUsual(weekStart, profile.usualWeek) : generateWeek(weekStart, protocol.weeklyTargets, profile.restDay)
    await d.plannedSessions.bulkAdd(drafts.map((x) => ({ ...newRecord(), ...x })))
  })
  return weekStart
}

/** F1.2: moving edits only this row. */
export async function movePlanned(id: string, toDate: string, d: BrainHealthDB = db) {
  const p = await d.plannedSessions.get(id)
  if (!p) return
  if (weekStartOf(toDate) !== p.weekStart) throw new Error('Sessions can only move within their week')
  await d.plannedSessions.update(id, {
    date: toDate,
    origin: p.origin === 'added' ? 'added' : 'moved',
    movedFromDate: p.movedFromDate ?? p.date,
    updatedAt: now(),
  })
}

export async function addPlanned(weekStart: string, date: string, activityType: ActivityKey, slot: 'am' | 'pm', d: BrainHealthDB = db) {
  await d.plannedSessions.add({ ...newRecord(), weekStart, date, activityType, slot, origin: 'added' })
}

export async function removePlanned(id: string, d: BrainHealthDB = db) {
  await d.plannedSessions.update(id, { deletedAt: now(), updatedAt: now() })
}

export interface LogSessionInput {
  date: string
  activityType: ActivityKey
  startAt: number
  durationMin: number
  intensity: Intensity
  plannedSessionId?: string
  distanceM?: number
  rpe?: number
  note?: string
  status?: SessionLog['status']
}

export async function logSession(input: LogSessionInput, d: BrainHealthDB = db): Promise<string> {
  const protocol = await currentProtocol(d)
  const rec: SessionLog = {
    ...newRecord(),
    status: 'done',
    ...input,
    protocolVersion: protocol.version,
  }
  await d.sessionLogs.add(rec)
  return rec.id
}

export async function updateSession(id: string, patch: Partial<SessionLog>, d: BrainHealthDB = db) {
  await d.sessionLogs.update(id, { ...patch, updatedAt: now() })
}

export async function deleteSession(id: string, d: BrainHealthDB = db) {
  await d.transaction('rw', [d.sessionLogs, d.setLogs], async () => {
    const t = now()
    await d.sessionLogs.update(id, { deletedAt: t, updatedAt: t })
    await d.setLogs.where('sessionId').equals(id).modify({ deletedAt: t, updatedAt: t })
  })
}

/** F1.6: mark a planned session skipped (stored as a skipped log so history keeps it). */
export async function skipPlanned(p: PlannedSession, d: BrainHealthDB = db) {
  await logSession(
    { date: p.date, activityType: p.activityType, startAt: Date.now(), durationMin: 0, intensity: 'light', plannedSessionId: p.id, status: 'skipped' },
    d,
  )
}

/** Undo done/skipped on a planned session: soft-delete its linked logs. */
export async function resetPlanned(plannedId: string, d: BrainHealthDB = db) {
  const logs = await d.sessionLogs.where('plannedSessionId').equals(plannedId).toArray()
  for (const l of alive(logs)) await deleteSession(l.id, d)
}

export async function sessionsInRange(fromKey: string, toKeyInclusive: string, d: BrainHealthDB = db) {
  return alive(await d.sessionLogs.where('date').between(fromKey, toKeyInclusive, true, true).toArray())
}

export const weekRange = (weekStart: string) => [weekStart, addDaysKey(weekStart, 6)] as const

const slug = (label: string) =>
  label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'activity'

export interface NewActivity {
  label: string
  defaultIntensity: Intensity
  isCardio: boolean
}

/** Add a user-defined activity. Re-adding a removed one with the same name brings it (and its history) back. */
export async function addCustomActivity(input: NewActivity, d: BrainHealthDB = db): Promise<CustomActivityKey> {
  const label = input.label.trim().replace(/\s+/g, ' ')
  if (!label) throw new Error('Name the activity')
  const key: CustomActivityKey = `custom_${slug(label)}`
  const t = now()
  const existing = await d.customActivities.get(key)
  const rec: CustomActivity = {
    key,
    label,
    defaultIntensity: input.defaultIntensity,
    isCardio: input.isCardio,
    // Custom activities only count against the pre-bed buffer when logged vigorous.
    isIntense: false,
    custom: true,
    createdAt: existing?.createdAt ?? t,
    updatedAt: t,
  }
  await d.customActivities.put(rec)
  return key
}

export async function removeCustomActivity(key: CustomActivityKey, d: BrainHealthDB = db) {
  await d.customActivities.update(key, { deletedAt: now(), updatedAt: now() })
}

export async function restoreCustomActivity(key: CustomActivityKey, d: BrainHealthDB = db) {
  await d.customActivities.update(key, { deletedAt: undefined, updatedAt: now() })
}

export async function setRestDay(wd: IsoWeekday, d: BrainHealthDB = db) {
  await updateProfile({ restDay: wd }, d)
}

export { toDateKey }

// ---------- Sleep ----------

export async function saveSleepLog(
  input: { night: string; bedAt: number; wakeAt: number; quality: SleepLog['quality']; note?: string },
  d: BrainHealthDB = db,
): Promise<string> {
  const existing = await d.sleepLogs.where('night').equals(input.night).first()
  if (existing) {
    await d.sleepLogs.update(existing.id, { ...input, deletedAt: undefined, updatedAt: now() })
    return existing.id
  }
  const rec: SleepLog = { ...newRecord(), ...input }
  await d.sleepLogs.add(rec)
  return rec.id
}

export async function deleteSleepLog(id: string, d: BrainHealthDB = db) {
  await d.sleepLogs.update(id, { deletedAt: now(), updatedAt: now() })
}

export async function setChecklistItem(night: string, itemKey: string, checked: boolean, d: BrainHealthDB = db) {
  const existing = await d.checklistLogs.where('[night+itemKey]').equals([night, itemKey]).first()
  if (existing) await d.checklistLogs.update(existing.id, { checked, deletedAt: undefined, updatedAt: now() })
  else await d.checklistLogs.add({ ...newRecord(), night, itemKey, checked })
}

// ---------- Caffeine ----------

export async function logCaffeine(preset: Pick<DrinkPreset, 'key' | 'label' | 'defaultMg'>, at = Date.now(), d: BrainHealthDB = db) {
  const rec: CaffeineLog = { ...newRecord(), date: toDateKey(at), at, drinkKey: preset.key, label: preset.label, mg: preset.defaultMg }
  await d.caffeineLogs.add(rec)
  return rec.id
}

export async function updateCaffeine(id: string, patch: Partial<Pick<CaffeineLog, 'at' | 'mg'>>, d: BrainHealthDB = db) {
  const extra = patch.at != null ? { date: toDateKey(patch.at) } : {}
  await d.caffeineLogs.update(id, { ...patch, ...extra, updatedAt: now() })
}

export async function deleteCaffeine(id: string, d: BrainHealthDB = db) {
  await d.caffeineLogs.update(id, { deletedAt: now(), updatedAt: now() })
}

export async function restoreCaffeine(id: string, d: BrainHealthDB = db) {
  await d.caffeineLogs.update(id, { deletedAt: undefined, updatedAt: now() })
}

export async function updateDrinkPreset(key: string, patch: Partial<Pick<DrinkPreset, 'defaultMg' | 'label' | 'hidden'>>, d: BrainHealthDB = db) {
  await d.drinkPresets.update(key, patch)
}

export async function addDrinkPreset(label: string, defaultMg: number, d: BrainHealthDB = db): Promise<string> {
  const clean = label.trim().replace(/\s+/g, ' ')
  if (!clean) throw new Error('Name the drink')
  const key = `custom_${slug(clean)}`
  const sort = (await d.drinkPresets.count()) + 1
  const existing = await d.drinkPresets.get(key)
  await d.drinkPresets.put({ key, label: clean, defaultMg, isCustom: true, hidden: false, sort: existing?.sort ?? sort })
  return key
}

// ---------- MIND diet ----------

export async function addServing(date: string, dietGroupKey: string, amount: number, mealTemplateId?: string, d: BrainHealthDB = db) {
  const rec: ServingLog = { ...newRecord(), date, dietGroupKey, amount, mealTemplateId, loggedAt: now() }
  await d.servingLogs.add(rec)
  return rec.id
}

/** F4.3 long-press undo: removes the most recent serving of that group on that day. */
export async function undoLastServing(date: string, dietGroupKey: string, d: BrainHealthDB = db): Promise<boolean> {
  const rows = alive(await d.servingLogs.where('date').equals(date).toArray()).filter((r) => r.dietGroupKey === dietGroupKey)
  const last = rows.sort((a, b) => b.loggedAt - a.loggedAt)[0]
  if (!last) return false
  await d.servingLogs.update(last.id, { deletedAt: now(), updatedAt: now() })
  return true
}

/** F5.2: a template meal adds all its servings at once; returns the ids so the toast can undo them together. */
export async function logMeal(date: string, template: MealTemplate, enabled: (groupKey: string) => boolean, d: BrainHealthDB = db): Promise<string[]> {
  const t = now()
  const rows: ServingLog[] = template.servings
    .filter((s) => enabled(s.dietGroupKey))
    .map((s) => ({ ...newRecord(), date, dietGroupKey: s.dietGroupKey, amount: s.amount, mealTemplateId: template.key, loggedAt: t }))
  await d.servingLogs.bulkAdd(rows)
  return rows.map((r) => r.id)
}

export async function deleteServings(ids: string[], d: BrainHealthDB = db) {
  const t = now()
  await d.servingLogs.bulkUpdate(ids.map((key) => ({ key, changes: { deletedAt: t, updatedAt: t } })))
}

// ---------- Strength ----------

/** A strength session in progress is a SessionLog with status 'active', so closing the app never loses it. */
export async function activeStrength(d: BrainHealthDB = db): Promise<SessionLog | undefined> {
  const rows = alive(await d.sessionLogs.where('status').equals('active').toArray())
  return rows.sort((a, b) => b.startAt - a.startAt)[0]
}

export async function startStrength(plannedSessionId?: string, d: BrainHealthDB = db): Promise<string> {
  const open = await activeStrength(d)
  if (open) return open.id
  const t = now()
  return logSession({ date: toDateKey(t), activityType: 'strength', startAt: t, durationMin: 0, intensity: 'moderate', plannedSessionId, status: 'active' }, d)
}

export async function saveSet(
  sessionId: string,
  exerciseKey: string,
  variant: string,
  setIndex: number,
  values: { weightKg?: number; reps?: number; holdSec?: number },
  d: BrainHealthDB = db,
) {
  const existing = alive(await d.setLogs.where('sessionId').equals(sessionId).toArray()).find((s) => s.exerciseKey === exerciseKey && s.setIndex === setIndex)
  if (existing) await d.setLogs.update(existing.id, { variant, ...values, updatedAt: now() })
  else await d.setLogs.add({ ...newRecord(), sessionId, exerciseKey, variant, setIndex, ...values })
}

export async function unsaveSet(sessionId: string, exerciseKey: string, setIndex: number, d: BrainHealthDB = db) {
  const rows = alive(await d.setLogs.where('sessionId').equals(sessionId).toArray()).filter((s) => s.exerciseKey === exerciseKey && s.setIndex === setIndex)
  for (const r of rows) await d.setLogs.update(r.id, { deletedAt: now(), updatedAt: now() })
}

export async function finishStrength(id: string, fields: { durationMin: number; intensity: Intensity; rpe?: number; note?: string }, d: BrainHealthDB = db) {
  // Link to today's planned strength session if the workout wasn't started from one.
  const s = await d.sessionLogs.get(id)
  let plannedSessionId = s?.plannedSessionId
  if (s && !plannedSessionId) {
    const planned = alive(await d.plannedSessions.where('date').equals(s.date).toArray()).filter((p) => p.activityType === 'strength')
    const taken = new Set(alive(await d.sessionLogs.where('date').equals(s.date).toArray()).map((l) => l.plannedSessionId))
    plannedSessionId = planned.find((p) => !taken.has(p.id))?.id
  }
  await d.sessionLogs.update(id, { ...fields, plannedSessionId, status: 'done', updatedAt: now() })
}

// ---------- Protocol edits ----------

/**
 * Save new diet targets as a new protocol version effective today. Earlier versions stay, so logs keep the
 * version they were made under. Returns the new version number (for undo).
 */
export async function saveDietTargets(targets: Record<string, number>, d: BrainHealthDB = db): Promise<number> {
  const cur = await currentProtocol(d)
  const next: ProtocolVersion = {
    ...cur,
    version: cur.version + 1,
    effectiveFrom: toDateKey(Date.now()),
    dietGroups: cur.dietGroups.map((g) => (targets[g.key] != null ? { ...g, target: targets[g.key] } : g)),
  }
  await d.protocols.put(validateProtocol(next))
  return next.version
}

/** Undo a just-saved edit: drop that version so the previous one is current again. Never removes v1. */
export async function dropProtocolVersion(version: number, d: BrainHealthDB = db) {
  if (version > 1) await d.protocols.delete(version)
}

/** The diet targets as first seeded from the protocol document. */
export const seedDietTargets = (): Record<string, number> => Object.fromEntries(protocolV1.dietGroups.map((g) => [g.key, g.target]))


/* ---------- weekly planning: repeat last week, usual week ---------- */

/** What a bulk plan change did, so it can be undone exactly. */
export interface PlanChange {
  /** rows that existed before, as they were (restored on undo) */
  before: PlannedSession[]
  /** rows created by the change (removed on undo) */
  added: string[]
}

async function linkedPlannedIds(weekStart: string, d: BrainHealthDB): Promise<Set<string>> {
  const logs = alive(await d.sessionLogs.where('date').between(weekStart, addDaysKey(weekStart, 6), true, true).toArray())
  return new Set(logs.map((l) => l.plannedSessionId).filter((x): x is string => !!x))
}

/** Replace this week's not-yet-done plan with a copy of last week's plan. Null when last week had nothing. */
export async function repeatLastWeek(weekStart: string, d: BrainHealthDB = db): Promise<PlanChange | null> {
  const prevStart = addDaysKey(weekStart, -7)
  const prev = alive(await d.plannedSessions.where('weekStart').equals(prevStart).toArray())
  if (!prev.length) return null
  const change: PlanChange = { before: [], added: [] }
  await d.transaction('rw', [d.plannedSessions, d.sessionLogs], async () => {
    const linked = await linkedPlannedIds(weekStart, d)
    const cur = alive(await d.plannedSessions.where('weekStart').equals(weekStart).toArray())
    for (const p of cur) {
      if (linked.has(p.id)) continue // done or skipped sessions stay
      change.before.push(p)
      await d.plannedSessions.update(p.id, { deletedAt: now(), updatedAt: now() })
    }
    for (const p of prev) {
      const row: PlannedSession = {
        ...newRecord(),
        weekStart,
        date: addDaysKey(p.date, 7),
        activityType: p.activityType,
        slot: p.slot,
        origin: 'template',
        ...(p.startTime ? { startTime: p.startTime } : {}),
        ...(p.durationMin ? { durationMin: p.durationMin } : {}),
        ...(p.note ? { note: p.note } : {}),
      }
      await d.plannedSessions.add(row)
      change.added.push(row.id)
    }
  })
  return change
}

/** Undo a PlanChange: drop what it added, put back what it changed or removed. */
export async function undoPlanChange(change: PlanChange, d: BrainHealthDB = db) {
  await d.transaction('rw', d.plannedSessions, async () => {
    for (const id of change.added) await d.plannedSessions.update(id, { deletedAt: now(), updatedAt: now() })
    for (const p of change.before) await d.plannedSessions.put(p)
  })
}

/** Save a week's plan as the usual week that new weeks start from. Returns the number of sessions saved. */
export async function saveUsualWeek(weekStart: string, d: BrainHealthDB = db): Promise<number> {
  const planned = alive(await d.plannedSessions.where('weekStart').equals(weekStart).toArray())
  const usualWeek = usualFromWeek(planned)
  await updateProfile({ usualWeek }, d)
  return usualWeek.length
}

export async function clearUsualWeek(d: BrainHealthDB = db) {
  await updateProfile({ usualWeek: undefined }, d)
}

/** Replace a week's not-yet-done plan with the usual week (or the protocol defaults when none is saved). */
export async function resetWeekToUsual(weekStart: string, d: BrainHealthDB = db): Promise<PlanChange> {
  const change: PlanChange = { before: [], added: [] }
  await d.transaction('rw', [d.plannedSessions, d.sessionLogs, d.protocols, d.profile], async () => {
    const linked = await linkedPlannedIds(weekStart, d)
    const cur = alive(await d.plannedSessions.where('weekStart').equals(weekStart).toArray())
    for (const p of cur) {
      if (linked.has(p.id)) continue
      change.before.push(p)
      await d.plannedSessions.update(p.id, { deletedAt: now(), updatedAt: now() })
    }
    const [protocol, profile] = await Promise.all([currentProtocol(d), getProfile(d)])
    const drafts = profile.usualWeek?.length ? weekFromUsual(weekStart, profile.usualWeek) : generateWeek(weekStart, protocol.weeklyTargets, profile.restDay)
    for (const x of drafts) {
      const row = { ...newRecord(), ...x }
      await d.plannedSessions.add(row)
      change.added.push(row.id)
    }
  })
  return change
}

/* ---------- imported sessions (from a booking screenshot, file or pasted text) ---------- */

export interface ImportedSession {
  date: string
  activityType: ActivityKey
  /** 'HH:mm' */
  startTime?: string
  durationMin?: number
  note?: string
}

export type ImportOutcome = 'added' | 'moved' | 'updated' | 'duplicate'

/**
 * Put imported sessions into the plan without double-counting the weekly targets:
 * a planned session of the same activity on that day gets the booking's time; otherwise an
 * open planned session of that activity elsewhere in the week moves to the booked day;
 * otherwise a new session is added. Exact repeats (same day, activity and start) are skipped.
 */
export async function applyImportedSessions(items: ImportedSession[], d: BrainHealthDB = db): Promise<{ change: PlanChange; outcomes: ImportOutcome[] }> {
  const change: PlanChange = { before: [], added: [] }
  const outcomes: ImportOutcome[] = []
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date))
  for (const it of sorted) await ensureWeek(it.date, d)
  await d.transaction('rw', [d.plannedSessions, d.sessionLogs], async () => {
    const touched = new Set<string>()
    for (const it of sorted) {
      const weekStart = weekStartOf(it.date)
      const linked = await linkedPlannedIds(weekStart, d)
      const week = alive(await d.plannedSessions.where('weekStart').equals(weekStart).toArray())
      const same = week.filter((p) => p.activityType === it.activityType)
      const slot: Slot = it.startTime ? slotOf(it.startTime) : 'pm'
      const fields = {
        ...(it.startTime ? { startTime: it.startTime, slot } : {}),
        ...(it.durationMin ? { durationMin: it.durationMin } : {}),
        ...(it.note ? { note: it.note } : {}),
        imported: true,
        updatedAt: now(),
      }
      const dup = same.find((p) => p.date === it.date && p.imported && (p.startTime ?? '') === (it.startTime ?? ''))
      if (dup) {
        outcomes.push('duplicate')
        continue
      }
      const onDay = same.find((p) => p.date === it.date && !p.imported && !linked.has(p.id) && !touched.has(p.id))
      const elsewhere = same
        .filter((p) => p.date !== it.date && !p.imported && !linked.has(p.id) && !touched.has(p.id))
        // move the one nearest the booked day
        .sort((a, b) => Math.abs(dayDiff(a.date, it.date)) - Math.abs(dayDiff(b.date, it.date)))[0]
      const target = onDay ?? elsewhere
      if (target) {
        change.before.push(target)
        touched.add(target.id)
        if (target === onDay) {
          await d.plannedSessions.update(target.id, fields)
          outcomes.push('updated')
        } else {
          await d.plannedSessions.update(target.id, { ...fields, date: it.date, origin: 'moved', movedFromDate: target.movedFromDate ?? target.date })
          outcomes.push('moved')
        }
      } else {
        const row: PlannedSession = { ...newRecord(), weekStart, date: it.date, activityType: it.activityType, slot, origin: 'added', ...fields }
        await d.plannedSessions.add(row)
        touched.add(row.id)
        change.added.push(row.id)
        outcomes.push('added')
      }
    }
  })
  return { change, outcomes }
}

const dayDiff = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 864e5

/* ---------- usual meals ---------- */

/** Save the usual meals as a new protocol version. Returns the new version number (for undo). */
export async function saveMealTemplates(mealTemplates: MealTemplate[], d: BrainHealthDB = db): Promise<number> {
  const cur = await currentProtocol(d)
  const next: ProtocolVersion = { ...cur, version: cur.version + 1, effectiveFrom: toDateKey(Date.now()), mealTemplates }
  await d.protocols.put(validateProtocol(next))
  return next.version
}

export const seedMealTemplates = (): MealTemplate[] => structuredClone(protocolV1.mealTemplates)
