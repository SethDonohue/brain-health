import { describe, expect, it } from 'vitest'
import { protocolV1 } from '../../domain/protocol.v1'
import { extractMeal, extractSessions, ImportError, MODEL, sharedToInput, testKey, toMealDraft } from '../extract'

const ok = (input: unknown) =>
  new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 't', name: 'x', input }] }), { status: 200, headers: { 'content-type': 'application/json' } })

describe('session import', () => {
  it('turns the pickleball booking screenshot answer into planned sessions', async () => {
    let sent: { url: string; init: RequestInit } | undefined
    const fetcher = (async (url: string, init: RequestInit) => {
      sent = { url, init }
      // what the model returns for the sample screenshot (Nov 10, 11, 12, 3-5 PM)
      return ok({
        sessions: ['2026-11-10', '2026-11-11', '2026-11-12'].map((date) => ({
          date,
          start_time: '15:00',
          end_time: '17:00',
          activity: 'pickleball',
          title: 'Happy Hour Open Play - 4.0+ (Advanced)',
        })),
      })
    }) as unknown as typeof fetch
    const drafts = await extractSessions('sk-ant-test', { kind: 'image', mime: 'image/png', base64: 'AAAA' }, protocolV1.activityTypes, '2026-11-05', fetcher)
    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toEqual({
      date: '2026-11-10',
      activityType: 'pickleball',
      startTime: '15:00',
      durationMin: 120,
      note: 'Happy Hour Open Play - 4.0+ (Advanced)',
      include: true,
      past: false,
    })
    const headers = sent!.init.headers as Record<string, string>
    expect(sent!.url).toBe('https://api.anthropic.com/v1/messages')
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    const body = JSON.parse(String(sent!.init.body))
    expect(body.model).toBe(MODEL)
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'add_sessions' })
    expect(body.messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } })
    expect(body.system).toContain('Today is 2026-11-05')
  })

  it('unticks past dates and maps an unknown activity to a real one', async () => {
    const fetcher = (async () => ok({ sessions: [{ date: '2026-11-01', activity: 'tennis' }] })) as unknown as typeof fetch
    const [d] = await extractSessions('k', { kind: 'text', text: 'Sun Nov 1 tennis' }, protocolV1.activityTypes, '2026-11-05', fetcher)
    expect(d.past).toBe(true)
    expect(d.include).toBe(false)
    expect(protocolV1.activityTypes.map((a) => a.key)).toContain(d.activityType)
  })

  it('explains a rejected key and a missing connection', async () => {
    const bad = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch
    await expect(testKey('nope', bad)).rejects.toThrow(/key wasn’t accepted/)
    const down = (async () => {
      throw new TypeError('network')
    }) as unknown as typeof fetch
    await expect(testKey('k', down)).rejects.toBeInstanceOf(ImportError)
  })
})

describe('meal import', () => {
  it('keeps known groups, rounds to halves, merges repeats and lists the rest', () => {
    const d = toMealDraft(
      {
        name: 'Lentil and spinach stew',
        servings: [
          { diet_group: 'beans', amount: 1.2, from: 'lentils' },
          { diet_group: 'leafy_greens', amount: 0.6, from: 'spinach' },
          { diet_group: 'leafy_greens', amount: 0.5, from: 'kale' },
          { diet_group: 'noodles', amount: 1, from: 'rice noodles' },
        ],
        not_counted: ['cumin'],
      },
      protocolV1.dietGroups,
    )
    expect(d.label).toBe('Lentil and spinach stew')
    expect(d.servings).toEqual([
      { dietGroupKey: 'beans', amount: 1, from: 'lentils' },
      { dietGroupKey: 'leafy_greens', amount: 1, from: 'spinach, kale' },
    ])
    expect(d.notCounted).toEqual(['cumin', 'rice noodles'])
  })

  it('sends a recipe as text with the food groups in the instructions', async () => {
    let body: { system: string; messages: { content: { type: string; text?: string }[] }[] } | undefined
    const fetcher = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body))
      return ok({ name: 'Salmon bowl', servings: [{ diet_group: 'fish', amount: 1 }] })
    }) as unknown as typeof fetch
    const d = await extractMeal('k', { kind: 'text', text: 'salmon, rice, greens' }, protocolV1.dietGroups, fetcher)
    expect(d.servings).toEqual([{ dietGroupKey: 'fish', amount: 1 }])
    expect(body!.system).toContain('leafy_greens')
    expect(body!.messages[0].content[0].text).toContain('salmon, rice, greens')
  })
})

describe('shared items', () => {
  it('maps share-sheet items to inputs', () => {
    expect(sharedToInput({ mime: 'text/plain', text: 'Tue 3pm open play' })).toEqual({ kind: 'text', text: 'Tue 3pm open play', name: undefined })
    expect(sharedToInput({ mime: 'image/png', base64: 'AA' })).toMatchObject({ kind: 'image', mime: 'image/png' })
    expect(sharedToInput({ mime: 'application/zip', base64: 'AA' })).toBeNull()
  })
})
