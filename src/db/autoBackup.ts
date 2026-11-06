import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { format } from 'date-fns'
import { buildBackup, shareFile } from './backup'
import { db, type BrainHealthDB } from './db'
import { getProfile, updateProfile } from './repo'

/** Folder for automatic backups, in the phone's shared Documents when Android allows it. */
export const BACKUP_DIR = 'BrainHealth'
/** How many automatic backups to keep. */
export const KEEP = 7
/** An automatic backup is due once this much time has passed since the last one. */
const DUE_MS = 20 * 3600e3
const NUDGE_EVERY_MS = 7 * 86400e3
const PREFIX = 'brain-health-auto-'

export type BackupPlace = 'documents' | 'app'
export interface SavedBackup {
  name: string
  place: BackupPlace
}

const dirOf = (place: BackupPlace) => (place === 'documents' ? Directory.Documents : Directory.Data)

/** Oldest auto-backup names beyond the newest `keep` (names sort by date). */
export function toPrune(names: string[], keep = KEEP): string[] {
  const auto = names.filter((n) => n.startsWith(PREFIX) && n.endsWith('.json')).sort()
  return auto.slice(0, Math.max(0, auto.length - keep))
}

export const autoBackupName = (at = new Date()) => `${PREFIX}${format(at, 'yyyy-MM-dd-HHmm')}.json`

async function listIn(place: BackupPlace): Promise<string[]> {
  try {
    const r = await Filesystem.readdir({ path: BACKUP_DIR, directory: dirOf(place) })
    return r.files.map((f) => f.name)
  } catch {
    return []
  }
}

/** Write a full backup now. Tries shared Documents first, then the app's own storage. */
export async function backupNow(d: BrainHealthDB = db): Promise<SavedBackup> {
  const name = autoBackupName()
  const data = JSON.stringify(await buildBackup(d))
  let place: BackupPlace = 'documents'
  try {
    await Filesystem.writeFile({ path: `${BACKUP_DIR}/${name}`, data, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true })
  } catch {
    place = 'app'
    await Filesystem.writeFile({ path: `${BACKUP_DIR}/${name}`, data, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true })
  }
  for (const old of toPrune(await listIn(place))) {
    await Filesystem.deleteFile({ path: `${BACKUP_DIR}/${old}`, directory: dirOf(place) }).catch(() => {})
  }
  await updateProfile({ lastAutoBackupAt: Date.now(), autoBackupPlace: place }, d)
  return { name, place }
}

/** Called at launch: back up when a day has passed. Only in the Android app. */
export async function autoBackupIfDue(d: BrainHealthDB = db): Promise<SavedBackup | null> {
  if (!Capacitor.isNativePlatform()) return null
  const p = await getProfile(d)
  if (p.autoBackup === false) return null
  if (p.lastAutoBackupAt && Date.now() - p.lastAutoBackupAt < DUE_MS) return null
  try {
    return await backupNow(d)
  } catch {
    return null
  }
}

/** Saved automatic backups, newest first, from both places. */
export async function listBackups(): Promise<SavedBackup[]> {
  if (!Capacitor.isNativePlatform()) return []
  const out: SavedBackup[] = []
  for (const place of ['documents', 'app'] as BackupPlace[]) {
    for (const name of await listIn(place)) if (name.startsWith(PREFIX) && name.endsWith('.json')) out.push({ name, place })
  }
  return out.sort((a, b) => b.name.localeCompare(a.name))
}

export async function readSaved(b: SavedBackup): Promise<unknown> {
  const r = await Filesystem.readFile({ path: `${BACKUP_DIR}/${b.name}`, directory: dirOf(b.place), encoding: Encoding.UTF8 })
  return JSON.parse(String(r.data))
}

/** A copy on the phone doesn't survive losing the phone: once a week, offer to send one elsewhere. */
export async function shouldNudgeShare(d: BrainHealthDB = db): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  const p = await getProfile(d)
  if (p.autoBackup === false) return false
  const last = Math.max(p.lastSharedAt ?? 0, p.lastBackupNudgeAt ?? 0)
  if (!p.lastSharedAt && !p.lastAutoBackupAt) return false
  return Date.now() - last > NUDGE_EVERY_MS
}

export async function shareFullBackup(d: BrainHealthDB = db) {
  await shareFile(`brain-health-backup-${format(new Date(), 'yyyy-MM-dd')}.json`, JSON.stringify(await buildBackup(d)), 'application/json')
  await updateProfile({ lastSharedAt: Date.now() }, d)
}
