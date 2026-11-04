import type { Units } from './types'

// Everything is stored metric (kg, metres, °C) and converted only for display, so switching never alters history.

export const KG_PER_LB = 0.45359237
export const M_PER_MI = 1609.344

export const kgToDisplay = (kg: number, u: Units): number => (u === 'metric' ? kg : kg / KG_PER_LB)
export const displayToKg = (v: number, u: Units): number => (u === 'metric' ? v : v * KG_PER_LB)
export const weightUnit = (u: Units) => (u === 'metric' ? 'kg' : 'lb')
/** Progression step: +2.5 kg or +5 lb. */
export const weightStep = (u: Units) => (u === 'metric' ? 2.5 : 5)

export const metersToDisplay = (m: number, u: Units): number => (u === 'metric' ? m / 1000 : m / M_PER_MI)
export const displayToMeters = (v: number, u: Units): number => (u === 'metric' ? v * 1000 : v * M_PER_MI)
export const distanceUnit = (u: Units) => (u === 'metric' ? 'km' : 'mi')

export const cToDisplay = (c: number, u: Units): number => (u === 'metric' ? c : (c * 9) / 5 + 32)
export const tempUnit = (u: Units) => (u === 'metric' ? '°C' : '°F')

/** Round for display: whole numbers when close, otherwise one decimal. */
export const fmt = (v: number, decimals = 1): string => {
  const r = Number(v.toFixed(decimals))
  return Number.isInteger(r) ? String(r) : r.toFixed(decimals)
}

/** Weight shown rounded to the nearest plate-friendly step (0.5 kg / 1 lb). */
export const fmtWeight = (kg: number, u: Units): string => {
  const v = kgToDisplay(kg, u)
  const step = u === 'metric' ? 0.5 : 1
  return fmt(Math.round(v / step) * step)
}

export const roomTempRange = ([lo, hi]: [number, number], u: Units): string =>
  u === 'metric' ? `${lo}–${hi} °C` : `${Math.round(cToDisplay(lo, u))}–${Math.round(cToDisplay(hi, u))} °F`
