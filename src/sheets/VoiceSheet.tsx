import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { logSession, openPlannedFor } from '../db/repo'
import { ridePartsText } from '../domain/cardio'
import { atMinutes, formatClock, formatDuration, fromDateKey, hmToMinutes, todayKey } from '../domain/dates'
import { parseVoiceLog, type VoiceDraft } from '../domain/voice'
import { activityOf, useProfile, useProtocol } from '../hooks'
import { useUi } from '../store'
import { Button, Sheet } from '../ui/primitives'

/** Say or type what you did; a preview shows what was understood, and nothing is saved until Log it. */
export function VoiceLogSheet() {
  const protocol = useProtocol()
  const profile = useProfile()
  const close = useUi((s) => s.close)
  const open = useUi((s) => s.open)
  const toast = useUi((s) => s.showToast)
  const [text, setText] = useState('')
  const today = todayKey()

  const result = useMemo(() => (protocol && text.trim() ? parseVoiceLog(text, protocol.activityTypes, today) : undefined), [protocol, text, today])
  if (!protocol || !profile) return null

  const draft = result?.ok ? result.draft : undefined
  const label = draft ? (activityOf(protocol, draft.activityType)?.label ?? 'Activity') : ''

  const save = async (d: VoiceDraft) => {
    const startHm = d.startHm ?? format(Date.now() - d.durationMin * 60_000, 'HH:mm')
    await logSession({
      date: d.date,
      activityType: d.activityType,
      startAt: atMinutes(d.date, hmToMinutes(startHm)),
      durationMin: d.durationMin,
      intensity: d.intensity,
      rpe: d.rpe,
      parts: d.parts,
      plannedSessionId: await openPlannedFor(d.date, d.activityType),
    })
    close()
    toast({ message: `${label} logged, ${summary(d)}` })
  }

  const summary = (d: VoiceDraft) => (d.parts ? ridePartsText({ parts: d.parts }, formatDuration)! : `${formatDuration(d.durationMin)} ${d.intensity}`)
  const dayText = (key: string) => (key === today ? 'Today' : format(fromDateKey(key), 'EEEE, MMM d'))

  return (
    <Sheet title="Log by voice">
      <label htmlFor="voice-text" className="block text-sm font-medium text-ink-2">
        What did you do?
      </label>
      <textarea
        id="voice-text"
        autoFocus
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Pickleball two hours yesterday"
        className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-lg"
      />
      <p className="mt-1 text-sm text-ink-3">Tap the microphone on your keyboard and say it. Try “pickleball from 2:45 pm to 6:15 pm yesterday” or “mountain bike 45 minutes up, 30 down, Saturday”.</p>

      {result && !result.ok && <p className="mt-3 text-sm text-amber">{result.reason}</p>}

      {draft && (
        <div className="mt-4 rounded-xl border border-line p-3" aria-label="What I understood">
          <div className="text-sm font-medium text-ink-2">I understood</div>
          <div className="mt-1 text-lg font-semibold">{label}</div>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
            <dt className="text-ink-3">Day</dt>
            <dd>{dayText(draft.date)}</dd>
            <dt className="text-ink-3">Length</dt>
            <dd className="num">{draft.parts ? `${summary(draft)} (${formatDuration(draft.durationMin)})` : formatDuration(draft.durationMin)}</dd>
            <dt className="text-ink-3">Intensity</dt>
            <dd>{draft.parts ? `${draft.parts.climb.intensity} up, ${draft.parts.descent.intensity} down` : draft.intensity}</dd>
            {draft.startHm && (
              <>
                <dt className="text-ink-3">Started</dt>
                <dd className="num">{formatClock(draft.startHm)}</dd>
              </>
            )}
            {draft.rpe != null && (
              <>
                <dt className="text-ink-3">Effort</dt>
                <dd className="num">{draft.rpe} of 10</dd>
              </>
            )}
          </dl>
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                close()
                open({ kind: 'log', prefill: draft })
              }}
            >
              Change details
            </Button>
            <Button className="flex-1" onClick={() => void save(draft)}>
              Log it
            </Button>
          </div>
        </div>
      )}
      <div className="pb-2" />
    </Sheet>
  )
}
