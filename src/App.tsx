import { App as CapApp } from '@capacitor/app'
import { useEffect, useRef } from 'react'
import { normalizeTabOrder } from './domain/sleep'
import { useProfile } from './hooks'
import { Onboarding } from './screens/Onboarding'
import { SettingsSheet } from './screens/Settings'
import { Eat } from './screens/Eat'
import { Sleep } from './screens/Sleep'
import { StrengthPlayer } from './screens/StrengthPlayer'
import { Train } from './screens/Train'
import { Week } from './screens/Week'
import { QuickLogBar, Today } from './screens/Today'
import { LogSessionSheet } from './sheets/LogSessionSheet'
import { MoveSheet, RestPickSheet } from './sheets/MoveSheet'
import { BedtimeSheet, DrinkEditSheet, DrinksSheet, SleepLogSheet } from './sheets/SleepSheets'
import { AddSessionSheet, ExerciseHistorySheet, PlannedSheet } from './sheets/TrainSheets'
import { EditMealsSheet, EditTargetsSheet, MindAboutSheet } from './sheets/EatSheets'
import { ImportSheet } from './sheets/ImportSheet'
import { useUi, type Tab } from './store'
import { onShared } from './ai/shareIn'
import { autoBackupIfDue, shareFullBackup, shouldNudgeShare } from './db/autoBackup'
import { updateProfile } from './db/repo'
import { cx, ToastHost } from './ui/primitives'

export const TAB_LABELS: Record<Tab, string> = { today: 'Today', sleep: 'Sleep', eat: 'Eat', train: 'Train', week: 'Week' }


export default function App() {
  const profile = useProfile()
  const { tab, setTab, sheets, player } = useUi()
  const footer = useRef<HTMLDivElement>(null)
  const order = normalizeTabOrder(profile?.tabOrder)
  const home = useRef<Tab>(order[0])
  home.current = order[0]
  const landed = useRef(false)
  const onboardedForBackup = !!profile?.onboarded

  // Open on the first tab in the user's order, once per launch.
  useEffect(() => {
    if (!profile || landed.current) return
    landed.current = true
    setTab(normalizeTabOrder(profile.tabOrder)[0])
  }, [profile, setTab])

  // Publish the footer's real height so content and toasts clear it exactly, whatever the system bar size.
  useEffect(() => {
    const el = footer.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--footer-h', `${el.getBoundingClientRect().height}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [profile?.onboarded])

  useEffect(() => {
    const sub = CapApp.addListener('backButton', () => {
      const s = useUi.getState()
      if (s.sheets.length) s.close()
      else if (s.player) s.setPlayer(false)
      else if (s.tab !== home.current) s.setTab(home.current)
      else void CapApp.minimizeApp()
    })
    return () => {
      void sub.then((h) => h.remove())
    }
  }, [])

  // Once per launch: a daily automatic backup, and a weekly offer to send one off the phone.
  const backedUp = useRef(false)
  useEffect(() => {
    if (!onboardedForBackup || backedUp.current) return
    backedUp.current = true
    void (async () => {
      await autoBackupIfDue()
      if (await shouldNudgeShare()) {
        await updateProfile({ lastBackupNudgeAt: Date.now() })
        useUi.getState().showToast({
          message: 'Backups are saved on this phone. Send one to Drive or Files?',
          action: { label: 'Send', run: () => void shareFullBackup().catch(() => {}) },
        })
      }
    })()
  })

  // Something shared to Brain Health from another app opens the import preview.
  const onboarded = !!profile?.onboarded
  useEffect(() => {
    if (!onboarded) return
    return onShared((input) => {
      const ui = useUi.getState()
      if (!input) return ui.showToast({ message: 'That can’t be imported. Share a screenshot, photo, PDF or text.' })
      ui.setPlayer(false)
      // a recipe shared as text or a photo still defaults to bookings; the sheet lets you switch
      ui.open({ kind: 'import', mode: 'sessions', shared: input })
    })
  }, [onboarded])

  if (!profile) return null
  if (!profile.onboarded) return <Onboarding profile={profile} />

  const top = sheets[sheets.length - 1]

  return (
    <div className="mx-auto min-h-full max-w-[480px]">
      {/* Solid strip behind the status bar so scrolled content never sits under the clock. */}
      <div aria-hidden="true" className="fixed inset-x-0 top-0 z-30 bg-bg" style={{ height: 'var(--sat)' }} />
      <main className="pt-[var(--sat)] pb-[calc(var(--footer-h)+24px)]">
        {tab === 'today' ? (
          <Today />
        ) : tab === 'sleep' ? (
          <Sleep />
        ) : tab === 'eat' ? (
          <Eat />
        ) : tab === 'train' ? (
          <Train />
        ) : (
          <Week />
        )}
      </main>

      <div ref={footer} className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[480px] border-t border-line bg-bg pb-[var(--sab)]">
        {tab === 'today' && <QuickLogBar />}
        <nav aria-label="Main" className="flex">
        {order.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t)
              window.scrollTo(0, 0)
            }}
            aria-current={tab === t ? 'page' : undefined}
            className={cx('relative flex min-h-14 min-w-0 flex-1 items-center justify-center px-0.5 text-[0.8125rem] font-medium', tab === t ? 'text-ink' : 'text-ink-3')}
          >
            {tab === t && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-ink" />}
            <span className="min-w-0 truncate">{TAB_LABELS[t]}</span>
          </button>
        ))}
        </nav>
      </div>

      {top?.kind === 'log' && <LogSessionSheet key={sheets.length} planned={top.planned} activity={top.activity} edit={top.edit} />}
      {top?.kind === 'move' && <MoveSheet planned={top.planned} />}
      {top?.kind === 'restPick' && <RestPickSheet weekStart={top.weekStart} candidates={top.candidates} />}
      {top?.kind === 'settings' && <SettingsSheet />}
      {top?.kind === 'sleepLog' && <SleepLogSheet night={top.night} />}
      {top?.kind === 'bedtime' && <BedtimeSheet />}
      {top?.kind === 'drinks' && <DrinksSheet />}
      {top?.kind === 'drinkEdit' && <DrinkEditSheet log={top.log} />}
      {top?.kind === 'planned' && <PlannedSheet planned={top.planned} />}
      {top?.kind === 'addSession' && <AddSessionSheet date={top.date} />}
      {top?.kind === 'exerciseHistory' && <ExerciseHistorySheet exerciseKey={top.exerciseKey} />}
      {top?.kind === 'editTargets' && <EditTargetsSheet />}
      {top?.kind === 'mindAbout' && <MindAboutSheet />}
      {top?.kind === 'editMeals' && <EditMealsSheet />}
      {top?.kind === 'import' && <ImportSheet key={sheets.length} mode={top.mode} shared={top.shared} />}
      {player && <StrengthPlayer />}
      <ToastHost />
    </div>
  )
}
