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
