import { format } from 'date-fns'
import { useEffect, useRef, useState } from 'react'
import { extractMeal, extractSessions, fileToInput, getApiKey, ImportError, mealFromDraft, type MealDraft, type SessionDraft } from '../ai/extract'
import type { ImportMode, SharedInput } from '../ai/types'
import { applyImportedSessions, currentProtocol, dropProtocolVersion, saveMealTemplates, undoPlanChange } from '../db/repo'
import { formatClock, formatDuration, fromDateKey } from '../domain/dates'
import { servingStep } from '../domain/mind'
import type { ActivityKey, DietGroup } from '../domain/types'
import { fmt } from '../domain/units'
import { useProfile, useProtocol, useToday } from '../hooks'
import { useUi } from '../store'
import { Button, cx, Segmented, Sheet, Stepper } from '../ui/primitives'

type Step = { at: 'input' } | { at: 'reading' } | { at: 'sessions'; drafts: SessionDraft[] } | { at: 'meal'; draft: MealDraft }

/** Read a screenshot, file or pasted text with Claude, then show an editable preview. Nothing saves until Save. */
export function ImportSheet({ mode: initialMode = 'sessions', shared }: { mode?: ImportMode; shared?: SharedInput }) {
  const protocol = useProtocol()
  const profile = useProfile()
  const today = useToday()
  const open = useUi((s) => s.open)
  const close = useUi((s) => s.close)
  const toast = useUi((s) => s.showToast)
  const [mode, setMode] = useState<ImportMode>(initialMode)
  const [input, setInput] = useState<SharedInput | undefined>(shared)
  const [text, setText] = useState('')
  const [step, setStep] = useState<Step>({ at: 'input' })
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const key = getApiKey()

  // A screenshot shared from another app arrives full size; shrink it like a picked file.
  useEffect(() => {
    if (shared?.kind !== 'image') return
    const bytes = Uint8Array.from(atob(shared.base64), (c) => c.charCodeAt(0))
    fileToInput(new Blob([bytes], { type: shared.mime }))
      .then(setInput)
      .catch(() => {})
  }, [shared])

  if (!protocol || !profile) return null
  const groups = protocol.dietGroups.filter((g) => !g.optional || (g.key === 'wine' && profile.wineEnabled))
  const activities = protocol.activityTypes.filter((a) => a.key !== 'rest' && !a.hidden)

  const pick = async (f: File | undefined) => {
    setError('')
    if (!f) return
    try {
      setInput(await fileToInput(f))
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const read = async () => {
    const src: SharedInput | undefined = text.trim() ? { kind: 'text', text: text.trim() } : input
    if (!src) return setError('Choose a screenshot or file, or paste some text first.')
    setError('')
    setStep({ at: 'reading' })
    try {
      if (mode === 'sessions') {
        const drafts = await extractSessions(key, src, activities, today)
        if (!drafts.length) {
          setStep({ at: 'input' })
          return setError('No sessions found. Try a screenshot that shows the dates and times.')
        }
        setStep({ at: 'sessions', drafts })
      } else {
        const draft = await extractMeal(key, src, groups)
        setStep({ at: 'meal', draft })
      }
    } catch (e) {
      setStep({ at: 'input' })
      setError(e instanceof ImportError ? e.message : 'Something went wrong reading that. Try again.')
    }
  }

  const saveSessions = async (drafts: SessionDraft[]) => {
    const chosen = drafts.filter((d) => d.include)
    const { change, outcomes } = await applyImportedSessions(chosen.map(({ include: _i, past: _p, ...s }) => s))
    const n = outcomes.filter((o) => o !== 'duplicate').length
    const dup = outcomes.length - n
    close()
    toast({
      message: n ? `Added ${n} ${n === 1 ? 'session' : 'sessions'} to your plan${dup ? `; ${dup} already there` : ''}` : 'Those sessions are already in your plan',
      ...(n ? { action: { label: 'Undo', run: () => void undoPlanChange(change) } } : {}),
    })
  }

  const saveMeal = async (draft: MealDraft) => {
    const cur = await currentProtocol()
    const meal = mealFromDraft(draft, cur.mealTemplates)
    const v = await saveMealTemplates([...cur.mealTemplates, meal])
    close()
    toast({ message: `${meal.label} added to your usual meals`, action: { label: 'Undo', run: () => void dropProtocolVersion(v) } })
  }

  if (step.at === 'sessions')
    return (
      <Sheet title="Check the sessions">
        <SessionPreview drafts={step.drafts} activities={activities} onBack={() => setStep({ at: 'input' })} onSave={saveSessions} />
      </Sheet>
    )
  if (step.at === 'meal')
    return (
      <Sheet title="Check the meal">
        <MealPreview draft={step.draft} groups={groups} onBack={() => setStep({ at: 'input' })} onSave={saveMeal} />
      </Sheet>
    )

  return (
    <Sheet title="Import">
      <div className="px-4 pt-4 pb-2">
        <Segmented
          label="What to import"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'sessions', label: 'Bookings' },
            { value: 'meal', label: 'A meal' },
          ]}
        />
        <p className="mt-3 text-sm text-ink-2">
          {mode === 'sessions'
            ? 'A screenshot of your bookings, a class schedule, or a confirmation message. Sessions go into your weekly plan.'
            : 'A recipe photo, file or pasted recipe. It becomes one of your usual meals on the Eat tab.'}
        </p>

        {!key ? (
          <div className="mt-4 rounded-xl bg-amber-soft px-4 py-3 text-sm">
            Importing reads your content with Claude, using your own API key. Add the key in Settings first.
            <Button variant="outline" className="mt-3 w-full" onClick={() => open({ kind: 'settings' })}>
              Open Settings
            </Button>
          </div>
        ) : (
          <>
            <input ref={fileRef} type="file" accept="image/*,application/pdf,text/plain" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
            <Button variant="outline" className="mt-4 w-full" onClick={() => fileRef.current?.click()}>
              {input ? 'Choose a different screenshot or file' : 'Choose a screenshot, photo or file'}
            </Button>
            {input && !text.trim() && <InputPreview input={input} onClear={() => setInput(undefined)} />}

            <label className="mt-4 block text-sm font-medium text-ink-2" htmlFor="import-text">
              Or paste text
            </label>
            <textarea
              id="import-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={mode === 'sessions' ? 'Tue Nov 10, 3:00–5:00 PM, Open Play' : 'Paste a recipe'}
              className="mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-base"
            />

            {error && (
              <p role="alert" className="mt-3 rounded-xl bg-red-soft px-4 py-3 text-sm">
                {error}
              </p>
            )}
            <Button className="mt-4 w-full" onClick={() => void read()} disabled={step.at === 'reading' || (!input && !text.trim())}>
              {step.at === 'reading' ? 'Reading…' : 'Read it'}
            </Button>
            <p className="mt-3 text-xs text-ink-3">
              {mode === 'sessions' ? 'Tip: in your booking app, take a screenshot, tap Share and pick Brain Health. ' : ''}
              Your content is sent to Claude to read it. You check everything before it's saved.
            </p>
          </>
        )}
      </div>
    </Sheet>
  )
}

function InputPreview({ input, onClear }: { input: SharedInput; onClear: () => void }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-line p-2">
      {input.kind === 'image' ? (
        <img src={`data:${input.mime};base64,${input.base64}`} alt="" className="h-16 w-12 shrink-0 rounded-lg object-cover object-top" />
      ) : (
        <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg bg-sunk text-xs font-semibold text-ink-2">{input.kind === 'pdf' ? 'PDF' : 'TXT'}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{input.name ?? (input.kind === 'image' ? 'Screenshot' : input.kind === 'pdf' ? 'PDF' : 'Text')}</span>
      <button onClick={onClear} className="min-h-11 min-w-11 px-2 text-sm font-medium text-ink-2">
        Remove
      </button>
    </div>
  )
}

function SessionPreview({
  drafts: initial,
  activities,
  onBack,
  onSave,
}: {
  drafts: SessionDraft[]
  activities: { key: ActivityKey; label: string }[]
  onBack: () => void
  onSave: (d: SessionDraft[]) => Promise<void>
}) {
  const [drafts, setDrafts] = useState(initial)
  const set = (i: number, patch: Partial<SessionDraft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const n = drafts.filter((d) => d.include).length
  return (
    <div className="px-4 pt-3 pb-2">
      <p className="text-sm text-ink-2">
        Found {drafts.length} {drafts.length === 1 ? 'session' : 'sessions'}. A planned session of the same kind moves to the booked day, so your weekly count stays right.
      </p>
      <ul className="mt-3 space-y-3">
        {drafts.map((d, i) => (
          <li key={i} className={cx('rounded-xl border p-3', d.include ? 'border-line' : 'border-dashed border-line opacity-70')}>
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={d.include} onChange={(e) => set(i, { include: e.target.checked })} className="h-5 w-5 accent-[var(--moderate)]" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {format(fromDateKey(d.date), 'EEE, MMM d')}
                  {d.startTime ? `, ${formatClock(d.startTime)}` : ''}
                  {d.durationMin ? ` (${formatDuration(d.durationMin)})` : ''}
                </span>
                {d.note && <span className="block text-sm text-ink-2">{d.note}</span>}
                {d.past && <span className="block text-xs text-amber">In the past, so not added unless you tick it</span>}
              </span>
            </label>
            {d.include && (
              <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
                <label className="text-xs text-ink-2">
                  Activity
                  <select value={d.activityType} onChange={(e) => set(i, { activityType: e.target.value as ActivityKey })} className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-bg px-2 text-base text-ink">
                    {activities.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink-2">
                  Date
                  <input type="date" value={d.date} onChange={(e) => e.target.value && set(i, { date: e.target.value, past: false })} className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-bg px-2 text-base text-ink" />
                </label>
                <label className="text-xs text-ink-2">
                  Start
                  <input type="time" value={d.startTime ?? ''} onChange={(e) => set(i, { startTime: e.target.value || undefined })} className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-bg px-2 text-base text-ink" />
                </label>
                <label className="text-xs text-ink-2">
                  Minutes
                  <input
                    type="number"
                    inputMode="numeric"
                    min={5}
                    max={600}
                    step={5}
                    value={d.durationMin ?? ''}
                    onChange={(e) => set(i, { durationMin: Number(e.target.value) || undefined })}
                    className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-bg px-2 text-base text-ink"
                  />
                </label>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="sticky bottom-0 mt-4 flex gap-2 bg-surface pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" disabled={!n} onClick={() => void onSave(drafts)}>
          {n ? `Add ${n} to plan` : 'Nothing ticked'}
        </Button>
      </div>
    </div>
  )
}

function MealPreview({ draft: initial, groups, onBack, onSave }: { draft: MealDraft; groups: DietGroup[]; onBack: () => void; onSave: (d: MealDraft) => Promise<void> }) {
  const [draft, setDraft] = useState(initial)
  return (
    <div className="px-4 pt-3 pb-2">
      <MealEditor label={draft.label} servings={draft.servings} groups={groups} onChange={(label, servings) => setDraft({ ...draft, label, servings })} />
      {draft.notCounted.length > 0 && <p className="mt-3 text-sm text-ink-3">Not counted in any food group: {draft.notCounted.join(', ')}.</p>}
      <p className="mt-2 text-xs text-ink-3">Amounts are one person's portion, estimated by Claude. Adjust them to what you actually eat.</p>
      <div className="sticky bottom-0 mt-4 flex gap-2 bg-surface pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" disabled={!draft.label.trim() || !draft.servings.length} onClick={() => void onSave(draft)}>
          Add to usual meals
        </Button>
      </div>
    </div>
  )
}

/** Name plus servings per food group; shared by the import preview and Edit meals. */
export function MealEditor({
  label,
  servings,
  groups,
  onChange,
}: {
  label: string
  servings: { dietGroupKey: string; amount: number; from?: string }[]
  groups: DietGroup[]
  onChange: (label: string, servings: { dietGroupKey: string; amount: number; from?: string }[]) => void
}) {
  const unused = groups.filter((g) => !servings.some((s) => s.dietGroupKey === g.key))
  const groupOf = (k: string) => groups.find((g) => g.key === k)
  return (
    <div>
      <label className="block text-sm font-medium text-ink-2" htmlFor="meal-name">
        Name
      </label>
      <input id="meal-name" value={label} onChange={(e) => onChange(e.target.value, servings)} className="mt-2 block min-h-12 w-full rounded-xl border border-line bg-bg px-3 text-base" />
      <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
        {servings.map((s, i) => {
          const g = groupOf(s.dietGroupKey)
          if (!g) return null
          const step = servingStep(g)
          return (
            <li key={s.dietGroupKey} className="px-3 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 font-medium">{g.label}</span>
                <button onClick={() => onChange(label, servings.filter((_, j) => j !== i))} className="min-h-11 min-w-11 shrink-0 px-2 text-sm font-medium text-ink-2">
                  Remove
                </button>
              </div>
              {s.from && <div className="-mt-1 mb-1 text-xs text-ink-3">From {s.from}</div>}
              <Stepper
                label={`${g.label} servings`}
                value={s.amount}
                step={step}
                min={step}
                max={g.unit === 'tbsp' ? 6 : 5}
                onChange={(v) => onChange(label, servings.map((x, j) => (j === i ? { ...x, amount: v } : x)))}
                format={(v) => `${fmt(v)}${g.unit === 'tbsp' ? ' tbsp' : ''}`}
              />
            </li>
          )
        })}
        {servings.length === 0 && <li className="px-3 py-3 text-sm text-ink-3">No food groups yet.</li>}
      </ul>
      {unused.length > 0 && (
        <label className="mt-3 block text-sm font-medium text-ink-2">
          Add a food group
          <select
            value=""
            onChange={(e) => {
              const g = groupOf(e.target.value)
              if (g) onChange(label, [...servings, { dietGroupKey: g.key, amount: servingStep(g) }])
            }}
            className="mt-2 block min-h-12 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink"
          >
            <option value="">Choose…</option>
            {unused.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
