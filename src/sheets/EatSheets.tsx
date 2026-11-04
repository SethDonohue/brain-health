import { useState } from 'react'
import { dropProtocolVersion, saveDietTargets, seedDietTargets } from '../db/repo'
import { bandText, MIND_BANDS, servingStep, targetText } from '../domain/mind'
import type { DietGroup } from '../domain/types'
import { fmt } from '../domain/units'
import { useProfile, useProtocol } from '../hooks'
import { useUi } from '../store'
import { Button, Sheet, Stepper } from '../ui/primitives'

/** Edit the personal targets for each food group. Saving makes a new protocol version; history keeps its own. */
export function EditTargetsSheet() {
  const protocol = useProtocol()
  const profile = useProfile()
  if (!protocol || !profile) return null
  const groups = protocol.dietGroups.filter((g) => !g.optional || (g.key === 'wine' && profile.wineEnabled))
  return <EditTargetsForm key={protocol.version} groups={groups} version={protocol.version} />
}

function EditTargetsForm({ groups, version }: { groups: DietGroup[]; version: number }) {
  const close = useUi((s) => s.close)
  const toast = useUi((s) => s.showToast)
  const start = Object.fromEntries(groups.map((g) => [g.key, g.target]))
  const [targets, setTargets] = useState<Record<string, number>>(start)
  const defaults = seedDietTargets()
  const changed = groups.some((g) => targets[g.key] !== start[g.key])
  const atDefaults = groups.every((g) => targets[g.key] === defaults[g.key])

  const save = async () => {
    const v = await saveDietTargets(targets)
    close()
    toast({ message: 'Targets saved', action: { label: 'Undo', run: () => void dropProtocolVersion(v) } })
  }

  const section = (kind: DietGroup['kind'], title: string) => (
    <section className="mb-6">
      <h3 className="mb-2 font-medium">{title}</h3>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {groups
          .filter((g) => g.kind === kind)
          .map((g) => {
            const band = MIND_BANDS[g.key]
            const step = servingStep(g)
            const draft = { ...g, target: targets[g.key] }
            const isDefault = targets[g.key] === defaults[g.key]
            return (
              <li key={g.key} className="px-3 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{g.label}</span>
                  <span className="text-sm text-ink-2">{targetText(draft)}</span>
                </div>
                <div className="mt-2">
                  <Stepper
                    label={`${g.label} target`}
                    value={targets[g.key]}
                    step={step}
                    min={step}
                    max={g.period === 'day' ? 10 : 30}
                    onChange={(v) => setTargets({ ...targets, [g.key]: v })}
                    format={(v) => fmt(v)}
                  />
                </div>
                <div className="mt-1 flex justify-between gap-2 text-xs text-ink-3">
                  <span>{band ? `Study ${bandText(band, g.unit)}` : 'No study band for wine'}</span>
                  {!isDefault && <span>Protocol: {fmt(defaults[g.key])}</span>}
                </div>
              </li>
            )
          })}
      </ul>
    </section>
  )

  return (
    <Sheet title="My targets">
      <p className="mb-4 text-sm text-ink-2">
        These are your own goals; the Eat tab marks "at target" against them. The study bands stay fixed for reference, and the Week tab's MIND score always uses the study's scoring. Past weeks keep the targets they had.
      </p>
      {section('do', 'Aim for')}
      {section('limit', 'Keep under')}
      <div className="flex gap-2 pb-2">
        <Button variant="quiet" disabled={atDefaults} onClick={() => setTargets(Object.fromEntries(groups.map((g) => [g.key, defaults[g.key] ?? g.target])))}>
          Reset to protocol
        </Button>
        <Button className="flex-1" disabled={!changed} onClick={() => void save()}>
          Save targets
        </Button>
      </div>
      <p className="pb-2 text-xs text-ink-3">Version {version} of your protocol is in use now.</p>
    </Sheet>
  )
}

/** Plain-language note on where the bands come from and how strong the evidence is. */
export function MindAboutSheet() {
  return (
    <Sheet title="About the MIND bands">
      <div className="space-y-4 pb-4 text-[15px] leading-relaxed">
        <p>
          The colored bands use the MIND diet scoring from Morris and colleagues (2015). For each of 15 food groups, the study gave 0, ½ or 1 point depending on how often
          people ate it. The darker the band, the more points that amount earned.
        </p>
        <p>
          Those cut-offs come from observational studies: older adults who scored higher tended to show slower cognitive decline and a lower rate of Alzheimer's disease. That
          shows an association, not that the diet caused the difference.
        </p>
        <p>
          A randomized trial (Barnes and colleagues, New England Journal of Medicine, 2023) assigned 604 older adults to the MIND diet or a control diet for three years. Both
          groups also cut calories slightly. Cognition improved in both groups, with no significant difference between them.
        </p>
        <p>So the bands are a reference for what the study counted, not proven thresholds. Your own targets, which you can edit, are what the Eat tab tracks.</p>
        <p>
          Wine has no band. The published scoring gives non-drinkers 0 points for wine, and this app doesn't nudge anyone to start drinking. When wine tracking is on, more than
          one glass a day never scores.
        </p>
        <p className="text-sm text-ink-2">This app tracks habits and isn't medical advice. Talk to a doctor or dietitian before major changes, especially with health conditions.</p>
      </div>
    </Sheet>
  )
}
