import Dexie, { type EntityTable } from 'dexie'
import type {
  CaffeineLog,
  ChecklistLog,
  CustomActivity,
  DrinkPreset,
  PlannedSession,
  Profile,
  ProtocolVersion,
  ServingLog,
  SessionLog,
  SetLog,
  SleepLog,
} from '../domain/types'

export class BrainHealthDB extends Dexie {
  profile!: EntityTable<Profile, 'id'>
  protocols!: EntityTable<ProtocolVersion, 'version'>
  plannedSessions!: EntityTable<PlannedSession, 'id'>
  sessionLogs!: EntityTable<SessionLog, 'id'>
  setLogs!: EntityTable<SetLog, 'id'>
  servingLogs!: EntityTable<ServingLog, 'id'>
  sleepLogs!: EntityTable<SleepLog, 'id'>
  checklistLogs!: EntityTable<ChecklistLog, 'id'>
  drinkPresets!: EntityTable<DrinkPreset, 'key'>
  caffeineLogs!: EntityTable<CaffeineLog, 'id'>
  customActivities!: EntityTable<CustomActivity, 'key'>

  constructor(name = 'brain-health') {
    super(name)
    // Schema v1. Future changes add .version(2).stores(...).upgrade(...) — never edit this block.
    this.version(1).stores({
      profile: 'id',
      protocols: 'version',
      plannedSessions: 'id, weekStart, date, activityType',
      sessionLogs: 'id, date, activityType, plannedSessionId, status, startAt',
      setLogs: 'id, sessionId, exerciseKey, [exerciseKey+variant]',
      servingLogs: 'id, date, dietGroupKey',
      sleepLogs: 'id, &night',
      checklistLogs: 'id, night, &[night+itemKey]',
      drinkPresets: 'key, sort',
      caffeineLogs: 'id, date, at',
    })
    // v2: user-defined activity types (hike, swim…).
    this.version(2).stores({ customActivities: 'key' })
  }
}

export const db = new BrainHealthDB()
