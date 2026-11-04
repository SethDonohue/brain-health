import type { DietGroup, ServingLog } from './types'

export type DoStatus = 'none' | 'partial' | 'met' | 'over'
export type LimitStatus = 'ok' | 'near' | 'cap'

export interface GroupProgress {
  group: DietGroup
  /** amount counted against the target: today's for daily groups, the week's for weekly ones */
  value: number
  today: number
  week: number
  target: number
  /** 0..1 for the ring */
  fraction: number
  status: DoStatus | LimitStatus
}

const sum = (logs: ServingLog[]) => logs.reduce((s, l) => s + l.amount, 0)

/** Limit groups turn amber at 75% of the cap and red at the cap (F4.4). */
export function limitStatus(value: number, cap: number): LimitStatus {
  if (value >= cap) return 'cap'
  if (value >= cap * 0.75) return 'near'
  return 'ok'
}

export function groupProgress(group: DietGroup, todayLogs: ServingLog[], weekLogs: ServingLog[]): GroupProgress {
  const today = sum(todayLogs.filter((l) => !l.deletedAt && l.dietGroupKey === group.key))
  const week = sum(weekLogs.filter((l) => !l.deletedAt && l.dietGroupKey === group.key))
  const value = group.period === 'day' ? today : week
  const target = group.target
  const fraction = Math.min(1, target > 0 ? value / target : 0)
  let status: GroupProgress['status']
  if (group.kind === 'limit') status = limitStatus(value, target)
  else if (group.atMost && value > target) status = 'over'
  else status = value >= target ? 'met' : value > 0 ? 'partial' : 'none'
  return { group, value, today, week, target, fraction, status }
}

/** Butter is counted in tablespoons, so it steps in halves; everything else in whole servings. */
export const servingStep = (g: DietGroup) => (g.unit === 'tbsp' ? 0.5 : 1)

export const periodWord = (g: DietGroup) => (g.period === 'day' ? 'today' : 'this week')

/** "6 a week", "under 1 a week", "1 a day" */
export function targetText(g: DietGroup): string {
  const per = g.period === 'day' ? 'a day' : 'a week'
  const unit = g.unit === 'tbsp' ? ' tbsp' : g.unit === 'glass' ? (g.target === 1 ? ' glass' : ' glasses') : ''
  if (g.kind === 'limit') return `under ${g.target}${unit} ${per}`
  if (g.atMost) return `up to ${g.target}${unit} ${per}`
  return `${g.target}${unit} ${per}`
}

// ---------- MIND study bands ----------
// Published MIND diet scoring (Morris et al., 2015): 0, ½ or 1 point per food group.
// These are the study's cut-offs, kept separate from the user's own targets; the Week score and the Eat bands
// both read from here so they can't disagree.

export type Points = 0 | 0.5 | 1

export type MindBand =
  /** more is better: full point at `full` or above, half at `half` or above */
  | { dir: 'more'; basis: 'week' | 'day'; full: number; half?: number }
  /** less is better: full point below `full`, half up to and including `half` */
  | { dir: 'less'; basis: 'week' | 'day'; full: number; half: number }

/** Wine has no band on purpose: its published scoring gives 0 to non-drinkers, which this app won't nudge toward. */
export const MIND_BANDS: Record<string, MindBand> = {
  leafy_greens: { dir: 'more', basis: 'week', full: 6, half: 3 },
  // published: at least 1 a day for the full point, 5–6 a week for half
  other_veg: { dir: 'more', basis: 'day', full: 1, half: 5 / 7 },
  berries: { dir: 'more', basis: 'week', full: 2, half: 1 },
  nuts: { dir: 'more', basis: 'week', full: 5, half: 1 },
  // "primary cooking oil": 1 point or none
  olive_oil: { dir: 'more', basis: 'day', full: 1 },
  whole_grains: { dir: 'more', basis: 'day', full: 3, half: 1 },
  fish: { dir: 'more', basis: 'week', full: 1 },
  beans: { dir: 'more', basis: 'week', full: 4, half: 1 },
  poultry: { dir: 'more', basis: 'week', full: 2, half: 1 },
  butter: { dir: 'less', basis: 'day', full: 1, half: 2 },
  cheese: { dir: 'less', basis: 'week', full: 1, half: 6 },
  red_meat: { dir: 'less', basis: 'week', full: 4, half: 6 },
  fried: { dir: 'less', basis: 'week', full: 1, half: 3 },
  sweets: { dir: 'less', basis: 'week', full: 5, half: 6 },
}

export function bandPoints(b: MindBand, v: number): Points {
  if (b.dir === 'more') return v >= b.full ? 1 : b.half != null && v >= b.half ? 0.5 : 0
  return v < b.full ? 1 : v <= b.half ? 0.5 : 0
}

export interface Zone {
  from: number
  to: number
  points: Points
}

/** The band as zones on a 0…max track. `step` is the logging step, so "up to 6" reaches the start of 7. */
export function bandZones(b: MindBand, max: number, step = 1): Zone[] {
  const z: Zone[] =
    b.dir === 'more'
      ? b.half != null
        ? [
            { from: 0, to: b.half, points: 0 },
            { from: b.half, to: b.full, points: 0.5 },
            { from: b.full, to: max, points: 1 },
          ]
        : [
            { from: 0, to: b.full, points: 0 },
            { from: b.full, to: max, points: 1 },
          ]
      : [
          { from: 0, to: b.full, points: 1 },
          { from: b.full, to: b.half + step, points: 0.5 },
          { from: b.half + step, to: max, points: 0 },
        ]
  return z.map((x) => ({ ...x, to: Math.min(x.to, max) })).filter((x) => x.to > x.from)
}

/** Track length: room past the last cut-off, the user's target and today's value. */
export function trackMax(b: MindBand, target: number, value: number, step = 1): number {
  const edge = b.dir === 'more' ? b.full : b.half + step
  return Math.max(edge * 1.35, target * 1.2, value * 1.08, step * 2)
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** Short description of the study's full-point cut-off, e.g. "full point at 6+ a week". */
export function bandText(b: MindBand, unit: DietGroup['unit']): string {
  const per = b.basis === 'day' ? ' a day' : ' a week'
  const u = unit === 'tbsp' ? ' tbsp' : ''
  return b.dir === 'more' ? `full point at ${num(b.full)}+${u}${per}` : `full point under ${num(b.full)}${u}${per}`
}
