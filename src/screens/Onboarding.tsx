import { useState } from 'react'
import { updateProfile } from '../db/repo'
import type { IsoWeekday, Profile, Units } from '../domain/types'
import { Button, Field } from '../ui/primitives'
import { changeRestDay, RestDayPicker, UNIT_OPTIONS } from './Settings'

/** First run: notice → units → bedtime → rest day. (Notification permissions arrive with reminders in M2.) */
export function Onboarding({ profile }: { profile: Profile }) {
  const [step, setStep] = useState(0)
  const [units, setUnits] = useState<Units>(profile.units)
  const [bed, setBed] = useState(profile.bedtimeDefault)
  const [wake, setWake] = useState(profile.wakeDefault)
  const [rest, setRest] = useState<IsoWeekday>(profile.restDay)

  const finish = async () => {
    await updateProfile({ units, bedtimeDefault: bed, wakeDefault: wake, noticeAcknowledged: true, onboarded: true })
    await changeRestDay(rest)
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[480px] flex-col px-5 pt-[calc(var(--sat)+48px)] pb-[max(var(--sab),24px)]">
      <div className="mb-8 text-sm text-ink-2">Step {step + 1} of 4</div>
      {step === 0 && (
        <>
          <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight">Your brain-health plan, one day at a time</h1>
          <p className="mt-4 text-lg text-ink-2">
            Track exercise, sleep habits, caffeine and MIND-style eating against your own protocol. Everything stays on this phone.
          </p>
          <p className="mt-6 rounded-xl bg-surface p-4 text-ink-2">
            This app tracks habits and is not a medical device. Check with a doctor before starting a demanding programme, especially with heart, joint or sleep conditions.
          </p>
        </>
      )}
      {step === 1 && (
        <>
          <h1 className="font-display text-3xl font-semibold">Units</h1>
          <p className="mt-2 mb-6 text-ink-2">You can switch any time; your history doesn't change.</p>
          <div className="space-y-2">
            {UNIT_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setUnits(o.value)}
                aria-pressed={units === o.value}
                className={`flex min-h-14 w-full items-center rounded-xl border px-4 text-left font-medium ${units === o.value ? 'border-ink bg-ink text-bg' : 'border-line'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <h1 className="font-display text-3xl font-semibold">Bedtime</h1>
          <p className="mt-2 mb-6 text-ink-2">Your caffeine cutoff, last hard exercise and warm shower are timed from this.</p>
          <Field label="Target bedtime">
            <input type="time" value={bed} onChange={(e) => e.target.value && setBed(e.target.value)} className="num min-h-14 rounded-xl border border-line bg-surface px-4 text-2xl" />
          </Field>
          <Field label="Usual wake time">
            <input type="time" value={wake} onChange={(e) => e.target.value && setWake(e.target.value)} className="num min-h-14 rounded-xl border border-line bg-surface px-4 text-2xl" />
          </Field>
        </>
      )}
      {step === 3 && (
        <>
          <h1 className="font-display text-3xl font-semibold">Rest day</h1>
          <p className="mt-2 mb-6 text-ink-2">Pick your usual full rest day. You can move it week to week.</p>
          <RestDayPicker value={rest} onChange={setRest} />
        </>
      )}
      <div className="mt-auto flex gap-2 pt-10">
        {step > 0 && (
          <Button variant="outline" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        <Button className="flex-1" onClick={() => (step < 3 ? setStep(step + 1) : void finish())}>
          {step === 0 ? 'I understand, continue' : step < 3 ? 'Next' : 'Start'}
        </Button>
      </div>
    </div>
  )
}
