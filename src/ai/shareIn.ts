import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { sharedToInput } from './extract'
import type { SharedInput } from './types'

interface ShareInPlugin {
  consume(): Promise<{ item?: { mime?: string; text?: string; base64?: string; name?: string } }>
  addListener(event: 'shared', fn: () => void): Promise<PluginListenerHandle>
}

const ShareIn = registerPlugin<ShareInPlugin>('ShareIn')

/** Calls back with each item shared to the app from Android's share sheet (cold start and while open). */
export function onShared(fn: (input: SharedInput | null) => void): () => void {
  if (Capacitor.getPlatform() !== 'android') return () => {}
  const take = async () => {
    try {
      const { item } = await ShareIn.consume()
      if (item) fn(sharedToInput(item))
    } catch {
      /* plugin missing on an old build: nothing to import */
    }
  }
  void take()
  const sub = ShareIn.addListener('shared', () => void take())
  return () => void sub.then((h) => h.remove())
}
