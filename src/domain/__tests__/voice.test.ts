import { describe, expect, it } from 'vitest'
import { protocolV1 } from '../protocol.v1'
import type { ActivityKey } from '../types'
import { numberWordsToDigits, parseDate, parseDuration, parseStart, parseVoiceLog } from '../voice'

const TODAY = '2026-11-18' // a Wednesday
const A = protocolV1.activityTypes
const draft = (s: string, types = A) => {
  const r = parseVoiceLog(s, types, TODAY)
  if (!r.ok) throw new Error(r.reason)
  return r.draft
}

describe('numbers and lengths', () => {
  it('turns number words into digits', () => {
    expect(numberWordsToDigits('forty five minutes')).toBe('45 minutes')
    expect(numberWordsToDigits('two hours and ten minutes')).toBe('2 hours and 10 minutes')
  })
  it.each([
    ['2 hours', 120], ['90 minutes', 90], ['45 min', 45], ['1.5 hours', 90], ['1 hour 30', 90], ['1 hour and 30 minutes', 90],
    ['an hour', 60], ['half an hour', 30], ['an hour and a half', 90], ['2 and a half hours', 150], ['quarter of an hour', 15],
  ])('%s → %i min', (t, min) => expect(parseDuration(t)).toBe(min))
  it('does not read a date as extra minutes', () => expect(parseDuration('2 hours 3 days ago')).toBe(120))
})

describe('dates and times', () => {
  it('reads days, never the future', () => {
    expect(parseDate('today', TODAY)).toBe('2026-11-18')
    expect(parseDate('yesterday', TODAY)).toBe('2026-11-17')
    expect(parseDate('2 days ago', TODAY)).toBe('2026-11-16')
    expect(parseDate('on monday', TODAY)).toBe('2026-11-16')
    expect(parseDate('on saturday', TODAY)).toBe('2026-11-14')
    expect(parseDate('wednesday', TODAY)).toBe('2026-11-18')
    expect(parseDate('last wednesday', TODAY)).toBe('2026-11-11')
  })
  it('reads a start time', () => {
    expect(parseStart('at 5 pm')).toBe('17:00')
    expect(parseStart('at 6:30 am')).toBe('06:30')
    expect(parseStart('at 4')).toBe('16:00')
    expect(parseStart('no time')).toBeUndefined()
  })
})

describe('whole sentences', () => {
  it('pickleball, two hours, moderate, yesterday', () => {
    expect(draft('pickleball two hours moderate yesterday')).toMatchObject({ activityType: 'pickleball', durationMin: 120, intensity: 'moderate', date: '2026-11-17' })
  })
  it('uses the activity default when no intensity is said', () => {
    expect(draft('Pickleball for an hour and a half')).toMatchObject({ durationMin: 90, intensity: 'moderate', date: TODAY })
    expect(draft('mountain biked 40 minutes')).toMatchObject({ activityType: 'mtb', durationMin: 40, intensity: 'vigorous' })
    expect(draft('bike commute 20 minutes').activityType).toBe('bike_commute')
    expect(draft('rode to work 25 minutes hard')).toMatchObject({ activityType: 'bike_commute', intensity: 'vigorous' })
  })
  it('splits a mountain bike ride into up and down', () => {
    const d = draft('mountain bike 45 minutes climbing and 30 down on Saturday')
    expect(d).toMatchObject({ activityType: 'mtb', durationMin: 75, intensity: 'vigorous', date: '2026-11-14' })
    expect(d.parts).toEqual({ climb: { min: 45, intensity: 'vigorous', rpe: 8 }, descent: { min: 30, intensity: 'vigorous', rpe: 6 } })
    expect(draft('mountain bike forty five up thirty down').parts).toMatchObject({ climb: { min: 45 }, descent: { min: 30 } })
    expect(draft('mtb climbing for 50 minutes descending 20 minutes').parts).toMatchObject({ climb: { min: 50 }, descent: { min: 20 } })
    expect(draft('mtb down 30 up 45').parts).toMatchObject({ climb: { min: 45 }, descent: { min: 30 } })
  })
  it('only one part said keeps the other at zero', () => {
    const d = draft('mountain bike 40 minutes up')
    expect(d.durationMin).toBe(40)
    expect(d.parts).toMatchObject({ climb: { min: 40 }, descent: { min: 0 } })
  })
  it('reads start time and effort', () => {
    expect(draft('pickleball 2 hours at 5 pm effort 7')).toMatchObject({ startHm: '17:00', rpe: 7, durationMin: 120 })
    expect(draft('strength 50 minutes 8 out of 10').rpe).toBe(8)
  })
  it('finds the owner’s own activities', () => {
    const types = [...A, { key: 'custom_hike' as ActivityKey, label: 'Hike', isIntense: false, isCardio: true, defaultIntensity: 'moderate' as const, custom: true }]
    expect(draft('hike 3 hours saturday', types)).toMatchObject({ activityType: 'custom_hike', durationMin: 180 })
  })
  it('asks instead of guessing', () => {
    expect(parseVoiceLog('', A, TODAY).ok).toBe(false)
    expect(parseVoiceLog('went for a long walk', A, TODAY)).toMatchObject({ ok: false })
    expect(parseVoiceLog('pickleball', A, TODAY)).toMatchObject({ ok: false })
    expect(parseVoiceLog('pickleball 2 hours and mountain bike 45 minutes', A, TODAY)).toMatchObject({ ok: false })
    expect(parseVoiceLog('pickleball 3 minutes', A, TODAY)).toMatchObject({ ok: false })
  })
})
