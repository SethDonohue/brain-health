import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { format } from 'date-fns'
import { z } from 'zod'
import { db, type BrainHealthDB } from './db'
import { alive } from './repo'
import type { ActivityType, SessionLog } from '../domain/types'
import { moderateEquivalent } from '../domain/cardio'

const APP = 'brain-health'
/** Tables that stay on this phone: not exported, not cleared by a restore. */
const DEVICE_ONLY = new Set(['secrets'])

export interface Backup {
  app: typeof APP
  schemaVersion: number
  exportedAt: string
  tables: Record<string, unknown[]>
}

/** Every table, every row (soft-deleted rows included), so a restore is lossless. */
export async function buildBackup(d: BrainHealthDB = db): Promise<Backup> {
  const tables: Record<string, unknown[]> = {}
  for (const t of d.tables) if (!DEVICE_ONLY.has(t.name)) tables[t.name] = await t.toArray()
  return { app: APP, schemaVersion: d.verno, exportedAt: new Date().toISOString(), tables }
}

const BackupSchema = z.object({
  app: z.literal(APP),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
})

/** Replace everything on this phone with a backup. Rejects files from other apps or newer schema versions. */
export async function restoreBackup(raw: unknown, d: BrainHealthDB = db): Promise<{ rows: number }> {
  const b = BackupSchema.parse(raw)
  if (b.schemaVersion > d.verno) throw new Error('This backup is from a newer version of the app. Update the app, then restore.')
  const tables = d.tables.filter((t) => !DEVICE_ONLY.has(t.name))
  const known = new Set(tables.map((t) => t.name))
  if (!b.tables.profile?.length) throw new Error('This backup has no profile, so it is not a full backup.')
  let rows = 0
  await d.transaction('rw', tables, async () => {
    for (const t of tables) await t.clear()
    for (const [name, list] of Object.entries(b.tables)) {
      if (!known.has(name)) continue
      await d.table(name).bulkPut(list)
      rows += list.length
    }
  })
  return { rows }
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Activity log as CSV for spreadsheets. Distances in km regardless of the display setting. */
export function sessionsCsv(sessions: SessionLog[], types: ActivityType[]): string {
  const label = (k: string) => types.find((t) => t.key === k)?.label ?? k
  const header = ['date', 'activity', 'start', 'duration_min', 'intensity', 'moderate_equivalent_min', 'distance_km', 'rpe', 'status', 'note']
  const rows = alive(sessions)
    .filter((s) => s.status !== 'active')
    .sort((a, b) => a.startAt - b.startAt)
    .map((s) => [
      s.date,
      label(s.activityType),
      format(s.startAt, 'HH:mm'),
      s.durationMin,
      s.intensity,
      s.status === 'done' && types.find((t) => t.key === s.activityType)?.isCardio ? moderateEquivalent(s.durationMin, s.intensity) : 0,
      s.distanceM != null ? (s.distanceM / 1000).toFixed(2) : '',
      s.rpe ?? '',
      s.status,
      s.note ?? '',
    ])
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

/** Hand a file to the user: the Android share sheet in the app (save to Drive, Files, email…), a download in a browser. */
export async function shareFile(name: string, contents: string, mime: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const res = await Filesystem.writeFile({ path: name, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8 })
    await Share.share({ title: name, files: [res.uri], dialogTitle: 'Save or send your data' })
    return
  }
  const url = URL.createObjectURL(new Blob([contents], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const backupName = () => `brain-health-backup-${format(new Date(), 'yyyy-MM-dd')}.json`
