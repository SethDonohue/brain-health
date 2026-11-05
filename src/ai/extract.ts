import { z } from 'zod'
import type { ActivityType, DietGroup, MealTemplate } from '../domain/types'
import type { ImportedSession } from '../db/repo'
import type { SharedInput } from './types'

/** The Haiku-tier model: fast and cheap, good at reading screenshots into structured data. */
export const MODEL = 'claude-haiku-5-5'
const API = 'https://api.anthropic.com/v1/messages'
const KEY_STORE = 'bh.anthropicKey'

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? ''
  } catch {
    return ''
  }
}
export function setApiKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORE, key.trim())
    else localStorage.removeItem(KEY_STORE)
  } catch {
    /* storage unavailable: the key just won't persist */
  }
}

export class ImportError extends Error {}

type Block = Record<string, unknown>

/** One forced tool call: the model must answer with the tool's JSON input. */
async function callTool(key: string, system: string, content: Block[], tool: { name: string; description: string; input_schema: object }, fetcher: typeof fetch = fetch) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ImportError('You’re offline. Importing needs a connection; everything else works offline.')
  let res: Response
  try {
    res = await fetcher(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // the app calls the API straight from the phone with the user's own key
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content }],
      }),
    })
  } catch {
    throw new ImportError('Couldn’t reach Claude. Check your connection and try again.')
  }
  if (res.status === 401 || res.status === 403) throw new ImportError('Your API key wasn’t accepted. Check it in Settings.')
  if (res.status === 429 || res.status === 529) throw new ImportError('Claude is busy or your key hit its limit. Try again in a minute.')
  if (res.status === 400) {
    const body = await res.json().catch(() => ({}))
    const msg = String(body?.error?.message ?? '')
    if (/credit|billing/i.test(msg)) throw new ImportError('Your Claude account is out of credit. Add some in the Claude Console.')
    throw new ImportError(`Claude couldn’t read that${msg ? `: ${msg}` : ''}.`)
  }
  if (!res.ok) throw new ImportError(`Claude returned an error (${res.status}). Try again.`)
  const body = await res.json()
  const use = (body.content as Block[] | undefined)?.find((b) => b.type === 'tool_use')
  if (!use) throw new ImportError('Claude didn’t return anything usable. Try a clearer screenshot or paste the text.')
  return use.input as unknown
}

function inputBlocks(input: SharedInput): Block[] {
  if (input.kind === 'image') return [{ type: 'image', source: { type: 'base64', media_type: input.mime, data: input.base64 } }]
  if (input.kind === 'pdf') return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.base64 } }]
  return [{ type: 'text', text: `<content>\n${input.text}\n</content>` }]
}

/** Cheap request that proves the key works. */
export async function testKey(key: string, fetcher: typeof fetch = fetch): Promise<void> {
  await callTool(key, 'Reply by calling the tool.', [{ type: 'text', text: 'ping' }], { name: 'ok', description: 'Acknowledge.', input_schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } }, fetcher)
}

/* ---------- planned sessions ---------- */

const sessionsOut = z.object({
  sessions: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      start_time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
      end_time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
      activity: z.string(),
      title: z.string().nullish(),
    }),
  ),
})

export interface SessionDraft extends ImportedSession {
  /** user can untick a row before saving; past dates start unticked */
  include: boolean
  past: boolean
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

export function toSessionDrafts(raw: unknown, activities: ActivityType[], today: string): SessionDraft[] {
  const parsed = sessionsOut.safeParse(raw)
  if (!parsed.success) throw new ImportError('Claude’s answer didn’t have the expected shape. Try again.')
  const keys = new Set(activities.map((a) => a.key))
  const fallback = activities.find((a) => a.key !== 'rest' && a.key !== 'strength')?.key ?? activities[0].key
  return parsed.data.sessions.map((s) => {
    const start = s.start_time ?? undefined
    const dur = start && s.end_time ? (minutes(s.end_time) - minutes(start) + 1440) % 1440 : undefined
    const past = s.date < today
    return {
      date: s.date,
      activityType: (keys.has(s.activity as never) ? s.activity : fallback) as ImportedSession['activityType'],
      ...(start ? { startTime: start } : {}),
      ...(dur ? { durationMin: dur } : {}),
      ...(s.title ? { note: s.title.trim() } : {}),
      include: !past,
      past,
    }
  })
}

export async function extractSessions(key: string, input: SharedInput, activities: ActivityType[], today: string, fetcher: typeof fetch = fetch): Promise<SessionDraft[]> {
  const choices = activities.filter((a) => a.key !== 'rest' && !a.hidden)
  const system = [
    'You read booking screenshots, schedules and messages and list the sessions in them for a personal exercise planner.',
    `Today is ${today}. When a date has no year, use the next occurrence on or after today.`,
    'Include only bookings or sessions the person is attending. Leave out cancelled ones.',
    'Ignore payment status, prices, buttons (Cancel, Details), category tags and navigation.',
    'Use 24-hour HH:mm times. Leave a time out when it isn’t shown.',
    `Pick the activity from these keys: ${choices.map((a) => `${a.key} (${a.label})`).join(', ')}. Court sports such as open play, drop-in or round robin at a pickleball club are pickleball.`,
    'Title is the session name as shown, without the time.',
  ].join('\n')
  const raw = await callTool(
    key,
    system,
    [...inputBlocks(input), { type: 'text', text: 'List every session in this content.' }],
    {
      name: 'add_sessions',
      description: 'The sessions found in the content.',
      input_schema: {
        type: 'object',
        properties: {
          sessions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'YYYY-MM-DD' },
                start_time: { type: 'string', description: 'HH:mm, 24-hour' },
                end_time: { type: 'string', description: 'HH:mm, 24-hour' },
                activity: { type: 'string', enum: choices.map((a) => a.key) },
                title: { type: 'string' },
              },
              required: ['date', 'activity'],
            },
          },
        },
        required: ['sessions'],
      },
    },
    fetcher,
  )
  return toSessionDrafts(raw, choices, today)
}

/* ---------- a usual meal from a recipe ---------- */

const mealOut = z.object({
  name: z.string(),
  servings: z.array(z.object({ diet_group: z.string(), amount: z.number(), from: z.string().nullish() })),
  not_counted: z.array(z.string()).nullish(),
})

export interface MealDraft {
  label: string
  servings: { dietGroupKey: string; amount: number; from?: string }[]
  notCounted: string[]
}

/** Round to the nearest half serving; drop zeros; merge repeats of a group. */
export function toMealDraft(raw: unknown, groups: DietGroup[]): MealDraft {
  const parsed = mealOut.safeParse(raw)
  if (!parsed.success) throw new ImportError('Claude’s answer didn’t have the expected shape. Try again.')
  const keys = new Set(groups.map((g) => g.key))
  const merged = new Map<string, { amount: number; from: string[] }>()
  const notCounted = [...(parsed.data.not_counted ?? [])]
  for (const s of parsed.data.servings) {
    if (!keys.has(s.diet_group)) {
      if (s.from) notCounted.push(s.from)
      continue
    }
    const m = merged.get(s.diet_group) ?? { amount: 0, from: [] }
    m.amount += s.amount
    if (s.from) m.from.push(s.from)
    merged.set(s.diet_group, m)
  }
  const servings = [...merged.entries()]
    .map(([dietGroupKey, m]) => ({ dietGroupKey, amount: Math.round(m.amount * 2) / 2, ...(m.from.length ? { from: m.from.join(', ') } : {}) }))
    .filter((s) => s.amount > 0)
  return { label: parsed.data.name.trim() || 'Imported meal', servings, notCounted }
}

export async function extractMeal(key: string, input: SharedInput, groups: DietGroup[], fetcher: typeof fetch = fetch): Promise<MealDraft> {
  const system = [
    'You turn a recipe or meal description into servings for a MIND-diet tracker. Count one person’s portion: divide the recipe by the number of servings it makes.',
    'Food groups, with what one serving is:',
    ...groups.map((g) => `- ${g.key}: ${g.label}, one ${g.unit} = ${g.servingHint}`),
    'Use only those keys. Amounts are in servings (olive oil in tablespoons), rounded to the nearest half. Leave out groups under a quarter serving.',
    'List ingredients that fit no group (spices, rice noodles, sauces) in not_counted.',
  ].join('\n')
  const raw = await callTool(
    key,
    system,
    [...inputBlocks(input), { type: 'text', text: 'Give the name of this meal and the servings in one person’s portion.' }],
    {
      name: 'add_meal',
      description: 'One person’s portion of the meal, as food-group servings.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          servings: {
            type: 'array',
            items: {
              type: 'object',
              properties: { diet_group: { type: 'string', enum: groups.map((g) => g.key) }, amount: { type: 'number' }, from: { type: 'string', description: 'the ingredients this counts' } },
              required: ['diet_group', 'amount'],
            },
          },
          not_counted: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'servings'],
      },
    },
    fetcher,
  )
  return toMealDraft(raw, groups)
}

export function mealFromDraft(d: MealDraft, existing: MealTemplate[]): MealTemplate {
  let key = `meal_${d.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'imported'}`
  while (existing.some((m) => m.key === key)) key += '_2'
  return { key, label: d.label, servings: d.servings.map(({ dietGroupKey, amount }) => ({ dietGroupKey, amount })) }
}

/* ---------- reading a picked or shared file ---------- */

/** Long side of an image sent to the model; larger costs more and reads no better. */
const MAX_SIDE = 1568

export async function fileToInput(file: Blob & { name?: string }): Promise<SharedInput> {
  const name = file.name
  if (file.type === 'application/pdf') return { kind: 'pdf', base64: await blobToBase64(file), name }
  if (file.type.startsWith('text/') || /\.(txt|md|csv)$/i.test(name ?? '')) return { kind: 'text', text: await file.text(), name }
  if (file.type.startsWith('image/')) return { kind: 'image', ...(await shrinkImage(file)), name }
  throw new ImportError('That file type isn’t supported. Use a screenshot, photo, PDF or text file.')
}

async function shrinkImage(file: Blob): Promise<{ mime: string; base64: string }> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 3_000_000 && /image\/(png|jpeg|webp|gif)/.test(file.type)) return { mime: file.type, base64: await blobToBase64(file) }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('encode'))), 'image/jpeg', 0.88))
    return { mime: 'image/jpeg', base64: await blobToBase64(blob) }
  } catch {
    throw new ImportError('Couldn’t open that image. Try a screenshot in PNG or JPEG.')
  }
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((ok, bad) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1] ?? '')
    r.onerror = () => bad(r.error)
    r.readAsDataURL(b)
  })
}

/** A shared item from Android's share sheet, as the native plugin hands it over. */
export function sharedToInput(item: { mime?: string; text?: string; base64?: string; name?: string }): SharedInput | null {
  if (item.text) return { kind: 'text', text: item.text, name: item.name }
  if (!item.base64) return null
  if (item.mime === 'application/pdf') return { kind: 'pdf', base64: item.base64, name: item.name }
  if (item.mime?.startsWith('image/')) return { kind: 'image', mime: item.mime === 'image/jpg' ? 'image/jpeg' : item.mime, base64: item.base64, name: item.name }
  return null
}
