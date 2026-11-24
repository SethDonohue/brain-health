import { addDaysKey, isoWeekday } from './dates'
import type { ActivityKey, ActivityType, Intensity, RidePart } from './types'

/**
 * Turns a spoken (or typed) sentence into a draft activity, with plain rules and no internet.
 * "pickleball two hours moderate yesterday", "pickleball from 2:45 pm to 6:15 pm yesterday"
 * or "mountain bike 45 minutes up and 30 down on Saturday".
 * Anything it can't read is left out and the owner fixes it in the preview, so it never guesses a number.
 */
export interface VoiceDraft {
  activityType: ActivityKey
  date: string
  durationMin: number
  intensity: Intensity
  /** mountain bike only, when climbing and/or descending minutes were said */
  parts?: { climb: RidePart; descent: RidePart }
  rpe?: number
  /** "HH:mm" when a start time was said */
  startHm?: string
}

export type VoiceResult = { ok: true; draft: VoiceDraft } | { ok: false; reason: string }

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** "forty five" → "45", "two" → "2". Words that aren't numbers are left alone. */
export function numberWordsToDigits(text: string): string {
  const w = Object.keys(ONES).join('|')
  const t = Object.keys(TENS).join('|')
  const re = new RegExp(`\\b(?:(${t})(?:\\s+(${w}))?|(${w}))\\b`, 'g')
  return text.replace(re, (_m, ten: string | undefined, one: string | undefined, solo: string | undefined) => {
    if (solo) return String(ONES[solo])
    return String(TENS[ten!] + (one ? ONES[one] : 0))
  })
}

const UNIT = '(hours?|hrs?|h|minutes?|mins?|m)'
const NUM = '(\\d+(?:\\.\\d+)?)'
const toMin = (n: number, unit?: string) => Math.round(unit && /^h/.test(unit) ? n * 60 : n)

/** Total length in minutes, or undefined. Expects text already lowercased with number words turned into digits. */
export function parseDuration(t: string): number | undefined {
  // "an hour and a half", "half an hour", "quarter of an hour"
  if (/\b(?:an?|1)\s+hour\s+and\s+a\s+half\b/.test(t)) return 90
  if (/\bhalf\s+(?:an?\s+)?hour\b/.test(t)) return 30
  if (/\bquarter\s+of\s+an\s+hour\b/.test(t)) return 15
  // "2 and a half hours", "1.5 hours", "1 hour 30", "1 hour and 30 minutes"
  const half = new RegExp(`${NUM}\\s+and\\s+a\\s+half\\s+${UNIT}\\b`).exec(t)
  if (half) return toMin(Number(half[1]) + 0.5, half[2])
  const hm = new RegExp(`${NUM}\\s*(?:hours?|hrs?|h)\\b(?:\\s*(?:and\\s*)?${NUM}(?!\\s*(?:days?|a\\.?m|p\\.?m|:|/|out))\\s*(?:minutes?|mins?|m)?\\b)?`).exec(t)
  if (hm) return Math.round(Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0))
  if (/\b(?:an?)\s+hour\b/.test(t)) return 60
  const m = new RegExp(`${NUM}\\s*(?:minutes?|mins?)\\b`).exec(t)
  if (m) return Math.round(Number(m[1]))
  return undefined
}

const UP = '(?:up|uphill|climbing|climb|climbs|climbed|ascending|ascent)'
const DOWN = '(?:down|downhill|descending|descent|descents|descended)'

interface NumAt {
  min: number
  idx: number
}

/** The number written just before the word ("45 minutes up") and just after it ("climbing for 45"). */
function partNumbers(t: string, word: string): { before?: NumAt; after?: NumAt } {
  const b = new RegExp(`${NUM}\\s*${UNIT}?\\s*(?:of\\s+)?${word}\\b`).exec(t)
  const a = new RegExp(`\\b${word}\\s*(?:for\\s+|was\\s+|about\\s+)?${NUM}\\s*${UNIT}?`).exec(t)
  return {
    before: b ? { min: toMin(Number(b[1]), b[2]), idx: b.index } : undefined,
    after: a ? { min: toMin(Number(a[1]), a[2]), idx: a.index + a[0].search(/\d/) } : undefined,
  }
}

/** Climbing and descending minutes. A number belongs to the word after it ("45 minutes up") unless the
 *  other word, having no number before it, claims it ("climbing 50 minutes descending 20": the 50 is the climb's). */
function ridePartMinutes(t: string): { up?: number; down?: number } {
  const up = partNumbers(t, UP)
  const down = partNumbers(t, DOWN)
  const pick = (me: ReturnType<typeof partNumbers>, other: ReturnType<typeof partNumbers>) =>
    me.before && (other.before || other.after?.idx !== me.before.idx) ? me.before.min : me.after?.min
  return { up: pick(up, down), down: pick(down, up) }
}

function parseIntensity(t: string): Intensity | undefined {
  if (/\b(?:vigorous|vigorously|hard|intense|intensely|all out|really hard)\b/.test(t)) return 'vigorous'
  if (/\b(?:moderate|moderately|medium|steady)\b/.test(t)) return 'moderate'
  if (/\b(?:light|lightly|easy|easily|gentle|gently|relaxed)\b/.test(t)) return 'light'
  return undefined
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

/** The date meant, defaulting to today. Never in the future. */
export function parseDate(t: string, today: string): string {
  if (/\bday before yesterday\b/.test(t)) return addDaysKey(today, -2)
  if (/\byesterday\b|\blast night\b/.test(t)) return addDaysKey(today, -1)
  const ago = /\b(\d+)\s+days?\s+ago\b/.exec(t)
  if (ago) return addDaysKey(today, -Number(ago[1]))
  for (let i = 0; i < 7; i++) {
    if (!new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)) continue
    const diff = (isoWeekday(today) - (i + 1) + 7) % 7
    // "last monday" on a Monday means a week ago; plain "monday" on a Monday means today
    return addDaysKey(today, -(diff === 0 && /\blast\s/.test(t) ? 7 : diff))
  }
  return today
}

/** "at 5 pm", "at 6:30", "at 5:15 in the evening". Without am/pm, 1–7 is taken as afternoon. */
export function parseStart(t: string): string | undefined {
  const m = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/.exec(t)
  if (!m) return undefined
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (h > 23 || min > 59) return undefined
  const ap = m[3]?.[0]
  if (ap === 'p' && h < 12) h += 12
  else if (ap === 'a' && h === 12) h = 0
  else if (!ap && h >= 1 && h <= 7) h += 12
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const TIME = `(noon|midnight|(\\d{1,2})(?:(?::|\\s)([0-5]\\d))?\\s*(a\\.?m\\b\\.?|p\\.?m\\b\\.?|o\\s?clock\\b)?)`

interface SaidTime {
  /** minutes after midnight, as said (12-hour clock unless a 13–23 hour was said) */
  min: number
  /** true when am/pm, noon/midnight or a 13–23 hour fixes the half of the day */
  fixed: boolean
  /** an hour with minutes or am/pm, not a bare number */
  clear: boolean
}

function readTime(word: string | undefined, hStr: string | undefined, mStr: string | undefined, ap: string | undefined): SaidTime | undefined {
  if (word === 'noon') return { min: 720, fixed: true, clear: true }
  if (word === 'midnight') return { min: 0, fixed: true, clear: true }
  let h = Number(hStr)
  const m = mStr ? Number(mStr) : 0
  if (h > 23) return undefined
  const a = ap?.[0]
  if (a === 'p' || a === 'a') {
    if (h > 12) return undefined
    if (a === 'p' && h < 12) h += 12
    else if (a === 'a' && h === 12) h = 0
    return { min: h * 60 + m, fixed: true, clear: true }
  }
  return { min: h * 60 + m, fixed: h > 12 || h === 0, clear: mStr != null || a === 'o' || h > 12 }
}

/** The ways an unfixed time could be meant: 3 → 3:00 or 15:00, 12 → noon or midnight. */
const halves = (t: SaidTime): number[] => (t.fixed ? [t.min] : t.min >= 720 ? [t.min, t.min - 720] : [t.min, t.min + 720])
const gap = (a: number, b: number) => (b - a + 1440) % 1440

/**
 * "from 2:45 pm to 6:15 pm", "between 2 and 4 pm", "2:45 until 6:15", "11 pm to 1 am".
 * Returns the start ("HH:mm") and the length in minutes. A time missing am/pm takes the half of the day that
 * makes the shortest sensible stretch; with no am/pm at all, a start from 1 to 7 is read as afternoon.
 * Needs "from"/"between", or a time that's clearly a clock time (with minutes or am/pm), so "2 to 3" alone isn't taken.
 */
export function parseTimeRange(t: string): { startHm: string; durationMin: number } | undefined {
  const re = new RegExp(`(\\bfrom\\s+|\\bbetween\\s+|\\bat\\s+)?${TIME}\\s*(?:to|till|til|until|through|thru|and)\\s+${TIME}`, 'g')
  for (const m of t.matchAll(re)) {
    const lead = m[1]?.trim()
    if (/\band\b/.test(m[0].slice((m[1] ?? '').length)) && lead !== 'between') continue
    const s = readTime(m[2], m[3], m[4], m[5])
    const e = readTime(m[6], m[7], m[8], m[9])
    if (!s || !e) continue
    if (!(lead === 'from' || lead === 'between') && !s.clear && !e.clear) continue

    let start: number
    if (s.fixed) start = s.min
    else if (e.fixed) start = halves(s).reduce((best, c) => (gap(c, e.min) > 0 && (gap(best, e.min) === 0 || gap(c, e.min) < gap(best, e.min)) ? c : best))
    else start = s.min >= 60 && s.min < 8 * 60 ? s.min + 720 : s.min // 1–7 without am/pm: afternoon, like "at 4"
    const end = halves(e).reduce((best, c) => (gap(start, c) > 0 && (gap(start, best) === 0 || gap(start, c) < gap(start, best)) ? c : best))
    const durationMin = gap(start, end)
    // same clock time twice ("from 3 to 3") isn't a stretch of time
    if (durationMin === 0 || (durationMin >= 720 && !(s.fixed && e.fixed))) continue
    const hm = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`
    return { startHm: hm, durationMin }
  }
  return undefined
}

const BUILTIN_WORDS: Record<string, string[]> = {
  bike_commute: ['bike commute', 'bike to work', 'biked to work', 'biking to work', 'ride to work', 'rode to work', 'commute', 'commuted', 'commuting'],
  mtb: ['mountain biking', 'mountain bike', 'mountain biked', 'mtb', 'trail ride', 'trails'],
  pickleball: ['pickleball', 'pickle ball'],
  strength: ['strength', 'weights', 'weight training', 'lifting', 'gym'],
}

/** Which activities the sentence names: the built-in words, then the labels of the owner's own activities. */
export function findActivities(t: string, activities: ActivityType[]): ActivityKey[] {
  const found: ActivityKey[] = []
  const take = (k: ActivityKey) => {
    if (!found.includes(k)) found.push(k)
  }
  let rest = t
  // Longer phrases first, and take them out so "bike commute" doesn't also match "commute" twice.
  const pairs: [string, ActivityKey][] = []
  for (const [k, words] of Object.entries(BUILTIN_WORDS)) for (const w of words) pairs.push([w, k as ActivityKey])
  for (const a of activities) if (a.custom && !a.hidden) pairs.push([a.label.toLowerCase(), a.key])
  pairs.sort((a, b) => b[0].length - a[0].length)
  for (const [w, k] of pairs) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    if (re.test(rest)) {
      take(k)
      rest = rest.replace(re, ' ')
    }
  }
  return found
}

export function parseVoiceLog(raw: string, activities: ActivityType[], today: string): VoiceResult {
  const t = numberWordsToDigits(
    raw
      .toLowerCase()
      .replace(/o['’]\s?clock/g, 'oclock')
      // "2:45-6:15" and "2 pm – 4 pm" are ranges: keep the dash's meaning before dashes become spaces
      .replace(/(\d|[ap]\.?m\.?)\s*[-–—]\s*(\d)/g, '$1 to $2')
      .replace(/[-–—,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  if (!t) return { ok: false, reason: 'Say or type what you did first.' }

  const found = findActivities(t, activities)
  if (found.length === 0) return { ok: false, reason: 'I didn’t catch the activity. Try “pickleball two hours yesterday”.' }
  if (found.length > 1) return { ok: false, reason: 'I heard more than one activity. Log them one at a time.' }
  const activityType = found[0]
  const def = activities.find((a) => a.key === activityType)?.defaultIntensity ?? 'moderate'
  const said = parseIntensity(t)

  let parts: VoiceDraft['parts']
  const range = parseTimeRange(t)
  let durationMin = range?.durationMin ?? parseDuration(t)
  if (activityType === 'mtb') {
    const { up, down } = ridePartMinutes(t)
    if (up != null || down != null) {
      parts = {
        climb: { min: up ?? 0, intensity: said ?? 'vigorous', rpe: 8 },
        descent: { min: down ?? 0, intensity: said ?? 'vigorous', rpe: 6 },
      }
      durationMin = (up ?? 0) + (down ?? 0)
    }
  }
  if (!durationMin || durationMin < 5) return { ok: false, reason: 'I didn’t catch how long. Say it like “two hours”, “45 minutes” or “from 2 to 4 pm”.' }
  if (durationMin > 600) return { ok: false, reason: 'That’s over ten hours. Please check the length.' }

  const rpeMatch = /\b(?:rpe|effort)\s*(?:of\s*)?(\d{1,2})\b/.exec(t) ?? /\b(\d{1,2})\s*(?:out of|\/)\s*10\b/.exec(t)
  const rpe = rpeMatch && Number(rpeMatch[1]) >= 1 && Number(rpeMatch[1]) <= 10 ? Number(rpeMatch[1]) : undefined

  const draft: VoiceDraft = {
    activityType,
    date: parseDate(t, today),
    durationMin,
    intensity: parts ? (parts.climb.min && parts.descent.min ? harder(parts.climb.intensity, parts.descent.intensity) : (parts.climb.min ? parts.climb : parts.descent).intensity) : (said ?? def),
    ...(parts ? { parts } : {}),
    ...(!parts && rpe != null ? { rpe } : {}),
    ...(range ? { startHm: range.startHm } : parseStart(t) ? { startHm: parseStart(t) } : {}),
  }
  return { ok: true, draft }
}

const RANK: Record<Intensity, number> = { light: 0, moderate: 1, vigorous: 2 }
const harder = (a: Intensity, b: Intensity): Intensity => (RANK[a] >= RANK[b] ? a : b)
