import { ulid } from 'ulid'
import { addDaysKey, toDateKey, weekStartOf } from '../domain/dates'
import { generateWeek } from '../domain/plan'
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
    const drafts = generateWeek(weekStart, protocol.weeklyTargets, profile.restDay)
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
