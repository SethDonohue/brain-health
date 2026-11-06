import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { db } from './db/db'
import { ensureSeed } from './db/repo'
import { migrateKeyFromLocalStorage } from './ai/extract'

async function boot() {
  // Ask the browser not to evict our IndexedDB under storage pressure.
  try {
    await navigator.storage?.persist?.()
  } catch {
    /* not available */
  }
  await db.open()
  await ensureSeed()
  await migrateKeyFromLocalStorage()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
