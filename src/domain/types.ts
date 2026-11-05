// Core entity types. Every stored record carries id, createdAt, updatedAt, deletedAt (soft delete).
// Dates are local calendar dates as 'yyyy-MM-dd'; instants are epoch milliseconds.

export type Units = 'metric' | 'imperial'
export type Intensity = 'light' | 'moderate' | 'vigorous'
export type BuiltinActivityKey = 'pickleball' | 'strength' | 'bike_commute' | 'mtb' | 'rest'
/** User-defined activities (hike, swim…) get keys starting with 'custom_'. */
export type CustomActivityKey = `custom_${string}`
export type ActivityKey = BuiltinActivityKey | CustomActivityKey
export type Slot = 'am' | 'pm'
/** ISO weekday: 1 = Monday … 7 = Sunday */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type TabKey = 'today' | 'sleep' | 'eat' | 'train' | 'week'
export const DEFAULT_TAB_ORDER: TabKey[] = ['today', 'sleep', 'eat', 'train', 'week']

export interface BaseRecord {
  id: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface Profile {
  id: 'me'
  name: string
  units: Units
  timezone: string
  /** 'HH:mm' */
  bedtimeDefault: string
  /** optional per-weekday override, keyed by ISO weekday */
  bedtimeByWeekday: Partial<Record<IsoWeekday, string>>
  /** 'HH:mm' usual wake time */
  wakeDefault: string
  restDay: IsoWeekday
  cardioFloorMin: number
  cardioTargetMin: number
  commuteDefaultMin: number
  wineEnabled: boolean
  restTimerSec: number
  noticeAcknowledged: boolean
  onboarded: boolean
  /** bottom-bar order; the first tab opens at launch. Missing on profiles from builds 1–2. */
  tabOrder?: TabKey[]
  /** saved usual week; when set, new weeks are generated from it instead of the protocol defaults */
  usualWeek?: UsualWeekItem[]
  updatedAt: number
}

export interface ActivityType {
  key: ActivityKey
  label: string
  /** intense activities fall under the 4-hour pre-bed buffer */
  isIntense: boolean
  /** cardio activities count toward the weekly moderate-equivalent goal */
  isCardio: boolean
  defaultIntensity: Intensity
  /** user-defined, not part of the protocol */
  custom?: boolean
  /** removed by the user: kept for labelling history, hidden from pickers */
  hidden?: boolean
}

export interface CustomActivity extends ActivityType {
  key: CustomActivityKey
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface WeeklyTarget {
  activityType: ActivityKey
  timesPerWeek: number
  durationMin: number
  durationMax: number
  defaultDays: IsoWeekday[]
  slot: Slot
  note: string
}

export type ExerciseTarget =
  | { kind: 'reps'; min: number; max: number }
  | { kind: 'hold'; minSec: number; maxSec: number }

export interface ExerciseVariant {
  key: string
  name: string
  target: ExerciseTarget
  /** this variant is loaded (shows a weight field) */
  weighted: boolean
}

export interface Exercise {
  key: string
  name: string
  targetSets: number
  variants: ExerciseVariant[]
  cue: string
  muscleGroups: string[]
}

export type DietKind = 'do' | 'limit'
export type DietPeriod = 'day' | 'week'

export interface DietGroup {
  key: string
  label: string
  kind: DietKind
  /** for 'do': minimum to reach; for 'limit': the cap (stay below) */
  target: number
  period: DietPeriod
  unit: 'serving' | 'tbsp' | 'glass'
  servingHint: string
  /** only shown when enabled in settings (wine) */
  optional?: boolean
  /** a 'do' group that should not be exceeded (wine ≤ 1/day) */
  atMost?: boolean
}

export interface MealTemplate {
  key: string
  label: string
  servings: { dietGroupKey: string; amount: number }[]
}

export interface ChecklistItem {
  key: string
  label: string
}

export interface SleepRules {
  caffeineCutoffHours: number
  exerciseCutoffHours: number
  showerMinutesBefore: number
  roomTempC: [number, number]
  checklist: ChecklistItem[]
}

export interface DrinkPresetSeed {
  key: string
  label: string
  defaultMg: number
}

export interface ProtocolVersion {
  version: number
  effectiveFrom: string
  activityTypes: ActivityType[]
  weeklyTargets: WeeklyTarget[]
  workout: { exercises: Exercise[]; sessionTargetMin: [number, number] }
  sleepRules: SleepRules
  dietGroups: DietGroup[]
  mealTemplates: MealTemplate[]
  drinkPresets: DrinkPresetSeed[]
  suggestionRules: string[]
}

export type PlannedOrigin = 'template' | 'moved' | 'added'

export interface PlannedSession extends BaseRecord {
  /** Monday of the ISO week, 'yyyy-MM-dd' */
  weekStart: string
  date: string
  activityType: ActivityKey
  slot: Slot
  origin: PlannedOrigin
  movedFromDate?: string
  /** 'HH:mm', when a booking or the usual week gives a real start time */
  startTime?: string
  /** planned length in minutes, from a booking or the usual week */
  durationMin?: number
  /** e.g. the booking name, "Happy Hour Open Play 4.0+" */
  note?: string
  /** set when the row came from an AI import */
  imported?: boolean
}

/** One session of the user's saved "usual week"; new weeks start from these when set. */
export interface UsualWeekItem {
  weekday: IsoWeekday
  activityType: ActivityKey
  slot: Slot
  startTime?: string
  durationMin?: number
  note?: string
}

export type SessionStatus = 'done' | 'skipped' | 'active'

export interface SessionLog extends BaseRecord {
  date: string
  activityType: ActivityKey
  plannedSessionId?: string
  startAt: number
  durationMin: number
  intensity: Intensity
  distanceM?: number
  rpe?: number
  status: SessionStatus
  note?: string
  protocolVersion: number
}

export interface SetLog extends BaseRecord {
  sessionId: string
  exerciseKey: string
  variant: string
  setIndex: number
  weightKg?: number
  reps?: number
  holdSec?: number
}

export interface ServingLog extends BaseRecord {
  date: string
  dietGroupKey: string
  amount: number
  mealTemplateId?: string
  loggedAt: number
}

export interface SleepLog extends BaseRecord {
  /** the evening's date the night started on */
  night: string
  bedAt: number
  wakeAt: number
  quality: 1 | 2 | 3 | 4 | 5
  note?: string
}

export interface ChecklistLog extends BaseRecord {
  night: string
  itemKey: string
  checked: boolean
}

export interface DrinkPreset {
  key: string
  label: string
  defaultMg: number
  isCustom: boolean
  hidden?: boolean
  sort: number
}

export interface CaffeineLog extends BaseRecord {
  date: string
  at: number
  drinkKey: string
  label: string
  mg: number
}
