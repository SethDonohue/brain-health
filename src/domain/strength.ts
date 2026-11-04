import type { Exercise, ExerciseVariant, SessionLog, SetLog, Units } from './types'
import { KG_PER_LB } from './units'

export interface SetPlan {
  weightKg?: number
  reps?: number
  holdSec?: number
}

export interface PastSession {
  session: SessionLog
  sets: SetLog[]
}

/** Past done sessions for one exercise variant, newest first. */
export function historyFor(exerciseKey: string, variant: string, sets: SetLog[], sessions: SessionLog[]): PastSession[] {
  const byId = new Map(sessions.filter((s) => !s.deletedAt && s.status === 'done').map((s) => [s.id, s]))
  const groups = new Map<string, SetLog[]>()
  for (const s of sets) {
    if (s.deletedAt || s.exerciseKey !== exerciseKey || s.variant !== variant || !byId.has(s.sessionId)) continue
    groups.set(s.sessionId, [...(groups.get(s.sessionId) ?? []), s])
  }
  return [...groups.entries()]
    .map(([id, ss]) => ({ session: byId.get(id)!, sets: ss.sort((a, b) => a.setIndex - b.setIndex) }))
    .sort((a, b) => b.session.startAt - a.session.startAt)
}

/** Every set reached the top of the range (or the longest hold). */
export function hitTop(v: ExerciseVariant, sets: SetLog[]): boolean {
  if (sets.length === 0) return false
  return v.target.kind === 'reps'
    ? sets.every((s) => (s.reps ?? 0) >= (v.target as { max: number }).max)
    : sets.every((s) => (s.holdSec ?? 0) >= (v.target as { maxSec: number }).maxSec)
}

/** Progression step stored in kg: +2.5 kg, or +5 lb for imperial users. */
export const stepKg = (u: Units) => (u === 'metric' ? 2.5 : 5 * KG_PER_LB)

export interface Prefill {
  sets: SetPlan[]
  /** set when last time every set hit the top of the range and the exercise is weighted (F2.3) */
  suggestIncrease?: { fromKg: number; toKg: number }
}

/** F2.3: prefill from last session; suggest the next weight step when all sets topped out. */
export function prefill(ex: Exercise, v: ExerciseVariant, past: PastSession[], units: Units): Prefill {
  const last = past[0]?.sets ?? []
  const defaultReps = v.target.kind === 'reps' ? v.target.min : undefined
  const defaultHold = v.target.kind === 'hold' ? v.target.minSec : undefined
  const sets: SetPlan[] = Array.from({ length: ex.targetSets }, (_, i) => {
    const prev = last[i] ?? last[last.length - 1]
    return {
      weightKg: v.weighted ? prev?.weightKg : undefined,
      reps: v.target.kind === 'reps' ? (prev?.reps ?? defaultReps) : undefined,
      holdSec: v.target.kind === 'hold' ? (prev?.holdSec ?? defaultHold) : undefined,
    }
  })
  if (!v.weighted || !hitTop(v, last)) return { sets }
  const fromKg = Math.max(...last.map((s) => s.weightKg ?? 0))
  if (fromKg <= 0) return { sets }
  const toKg = fromKg + stepKg(units)
  return {
    sets: sets.map((s) => ({ ...s, weightKg: toKg, reps: defaultReps })),
    suggestIncrease: { fromKg, toKg },
  }
}

export const targetLabel = (ex: Exercise, v: ExerciseVariant): string =>
  v.target.kind === 'reps'
    ? `${ex.targetSets} × ${v.target.min === v.target.max ? v.target.min : `${v.target.min}–${v.target.max}`}`
    : `${ex.targetSets} × ${v.target.minSec}–${v.target.maxSec} s`
