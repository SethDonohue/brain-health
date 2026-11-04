import { format } from 'date-fns'
import { db } from '../db/db'
import { alive, movePlanned } from '../db/repo'
import { fromDateKey, weekDays } from '../domain/dates'
import { checkRestDay } from '../domain/plan'
import type { ActivityType, PlannedSession } from '../domain/types'
import { activityOf, useProtocol, useWeek } from '../hooks'
import { useUi } from '../store'
import { Button, cx, Sheet } from '../ui/primitives'

export function MoveSheet({ planned }: { planned: PlannedSession }) {
  const protocol = useProtocol()
  const week = useWeek(planned.date)
  const close = useUi((s) => s.close)
  if (!protocol || !week) return null
  const label = activityOf(protocol, planned.activityType)?.label ?? ''

  const moveTo = async (date: string) => {
    close()
    await moveWithRestCheck(planned, date, protocol.activityTypes, label)
  }

  return (
    <Sheet title={`Move ${label.toLowerCase()}`}>
      <ul className="space-y-2 pb-2">
        {weekDays(week.weekStart).map((d) => {
          const here = week.planned.filter((p) => p.date === d && p.id !== planned.id)
          const current = d === planned.date
          return (
            <li key={d}>
              <button
                disabled={current}
                onClick={() => moveTo(d)}
                className={cx(
                  'flex min-h-14 w-full items-center justify-between rounded-xl border px-4 text-left',
                  current ? 'border-ink' : 'border-line active:bg-sunk',
                )}
              >
                <span className="font-medium">{format(fromDateKey(d), 'EEEE')}</span>
                <span className="text-sm text-ink-2">
                  {current ? 'Current' : here.map((p) => activityOf(protocol, p.activityType)?.label).join(', ') || 'Free'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}

/** Move a planned session, then (F1.2) ask for a new rest day if the move took it over. Used by the sheet and by drag. */
export async function moveWithRestCheck(planned: PlannedSession, date: string, types: ActivityType[], label: string) {
  if (date === planned.date) return
  const { open, showToast } = useUi.getState()
  const from = planned.date
  await movePlanned(planned.id, date)
  const after = alive(await db.plannedSessions.where('weekStart').equals(planned.weekStart).toArray())
  const check = checkRestDay(planned.weekStart, after, types)
  if (check.conflict && check.candidates.length > 0) open({ kind: 'restPick', weekStart: planned.weekStart, candidates: check.candidates })
  showToast({
    message: `${label} moved to ${format(fromDateKey(date), 'EEEE')}`,
    action: { label: 'Undo', run: () => void movePlanned(planned.id, from) },
  })
}

/** F1.2: after a move lands on the rest day, ask which day becomes the rest day. */
export function RestPickSheet({ weekStart, candidates }: { weekStart: string; candidates: string[] }) {
  const week = useWeek(weekStart)
  const close = useUi((s) => s.close)
  if (!week) return null
  const rest = week.planned.find((p) => p.activityType === 'rest')
  return (
    <Sheet title="Pick a rest day">
      <p className="mb-4 text-ink-2">That move put activity on your rest day. Which day should be rest this week?</p>
      <ul className="space-y-2">
        {candidates.map((d) => (
          <li key={d}>
            <button
              onClick={async () => {
                if (rest) await movePlanned(rest.id, d)
                close()
              }}
              className="flex min-h-14 w-full items-center rounded-xl border border-line px-4 font-medium active:bg-sunk"
            >
              {format(fromDateKey(d), 'EEEE')}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="quiet" onClick={close} className="mt-3 mb-2 w-full">
        Keep it as it is
      </Button>
    </Sheet>
  )
}
