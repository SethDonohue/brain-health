import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { getApiKey, migrateKeyFromLocalStorage, setApiKey } from '../../ai/extract'
import { toPrune } from '../autoBackup'
import { buildBackup, restoreBackup } from '../backup'
import { BrainHealthDB } from '../db'
import { currentProtocol, ensureSeed } from '../repo'

describe('API key storage', () => {
  it('lives in the database, stays out of backups, and survives a restore', async () => {
    const d = new BrainHealthDB('k1')
    await ensureSeed(d)
    await setApiKey(' sk-ant-123 ', d)
    expect(await getApiKey(d)).toBe('sk-ant-123')
    const b = await buildBackup(d)
    expect(b.tables.secrets).toBeUndefined()
    expect(JSON.stringify(b)).not.toContain('sk-ant-123')
    await restoreBackup(b, d)
    expect(await getApiKey(d)).toBe('sk-ant-123')
    await setApiKey('', d)
    expect(await getApiKey(d)).toBe('')
  })

  it('moves a key saved by build 6 out of localStorage once', async () => {
    const store = new Map<string, string>([['bh.anthropicKey', 'sk-ant-old']])
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage
    const d = new BrainHealthDB('k2')
    await migrateKeyFromLocalStorage(d)
    expect(await getApiKey(d)).toBe('sk-ant-old')
    expect(store.has('bh.anthropicKey')).toBe(false)
  })
})

describe('automatic backups', () => {
  it('keeps the newest seven auto-backups and ignores other files', () => {
    const names = Array.from({ length: 9 }, (_, i) => `brain-health-auto-2026-11-${String(i + 1).padStart(2, '0')}-0800.json`)
    expect(toPrune([...names, 'notes.txt', 'brain-health-backup-2026-11-01.json'])).toEqual(names.slice(0, 2))
    expect(toPrune(names.slice(0, 3))).toEqual([])
  })
})

describe('smoothie meals', () => {
  it('a fresh install has the full and half smoothie', async () => {
    const d = new BrainHealthDB('sm1')
    await ensureSeed(d)
    const keys = (await currentProtocol(d)).mealTemplates.map((m) => m.key)
    expect(keys).toContain('meal_mind_smoothie')
    expect(keys).toContain('meal_mind_smoothie_half')
  })
})
