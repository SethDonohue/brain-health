import { useEffect, useRef, useState } from 'react'
import { blendPose, BONES, FLOOR_Y, packAt, phase, solve, VIEW, type Demo, type Figure, type Pose, type Pt } from '../domain/demos'

/** A small circled "i" that opens an exercise demo. 48 px tap target. */
export function InfoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} className="flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl text-ink-2 active:bg-sunk">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="11" cy="11" r="9" />
        <path d="M11 10v6" strokeLinecap="round" />
        <circle cx="11" cy="6.6" r="0.6" fill="currentColor" />
      </svg>
    </button>
  )
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The looping stick-figure demo. Tap to pause or play. */
export function ExerciseDemo({ demo, label }: { demo: Demo; label: string }) {
  const [playing, setPlaying] = useState(() => !reducedMotion())
  const [sec, setSec] = useState(() => demo.timing[0])
  const last = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = (now: number) => {
      if (last.current != null) setSec((s) => s + (now - last.current!) / 1000)
      last.current = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      last.current = null
    }
  }, [playing])

  const pose = blendPose(demo.top, demo.bottom, phase(demo, sec))

  return (
    <button
      onClick={() => setPlaying((p) => !p)}
      aria-label={`${label} demo, ${playing ? 'playing. Tap to pause' : 'paused. Tap to play'}`}
      className="relative block w-full rounded-xl bg-sunk"
    >
      <DemoSvg demo={demo} pose={pose} />
      <span className="absolute right-2 bottom-1.5 text-xs text-ink-3">{playing ? 'Tap to pause' : 'Tap to play'}</span>
    </button>
  )
}

/** One frame of a demo. */
export function DemoSvg({ demo, pose }: { demo: Demo; pose: Pose }) {
  const f = solve(pose, demo)
  const [vx, vy, vw, vh] = demo.view ?? VIEW
  const behind = demo.props.filter((p) => p.kind === 'box' || p.kind === 'post' || p.kind === 'bar')
  return (
    <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} className="block w-full" role="img" aria-hidden="true">
      <line x1={vx + 6} y1={FLOOR_Y} x2={vx + vw - 6} y2={FLOOR_Y} stroke="var(--line)" strokeWidth="2" />
      {behind.map((p, i) =>
        p.kind === 'box' ? (
          <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx="3" fill="var(--line)" />
        ) : p.kind === 'post' ? (
          <line key={i} x1={p.x} y1={p.top} x2={p.x} y2={FLOOR_Y} stroke="var(--line)" strokeWidth="5" strokeLinecap="round" />
        ) : p.kind === 'bar' ? (
          <path key={i} d={line([p.at[0] - 12, p.at[1]], [p.at[0] + 12, p.at[1]])} stroke="var(--ink-2)" strokeWidth="5" strokeLinecap="round" />
        ) : null,
      )}
      <Body f={f} front={demo.front} far={demo.front || demo.farSolid ? 'solid' : 'faded'} />
      {demo.props.some((p) => p.kind === 'pack') && <Pack f={f} torso={pose.torso} />}
      {demo.props.map((p, i) =>
        p.kind === 'band' ? <path key={i} d={line(p.from, f.hands[0])} stroke="var(--moderate)" strokeWidth="2" strokeLinecap="round" /> : null,
      )}
      {demo.props.some((p) => p.kind === 'slider') && <rect x={f.ankles[0][0] - 8} y={FLOOR_Y - 3} width="16" height="3" rx="1" fill="var(--moderate)" />}
      <Body f={f} front={demo.front} />
      {demo.props.map((p, i) =>
        p.kind === 'dumbbells' ? (
          <g key={i}>
            <Dumbbell at={f.hands[0]} vertical={p.vertical} />
            {demo.front && <Dumbbell at={f.hands[1]} vertical={p.vertical} />}
          </g>
        ) : null,
      )}
    </svg>
  )
}

const line = (a: Pt, b: Pt) => `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`
const chain = (...p: Pt[]) => p.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('')

/** The near side in full ink with the trunk and head, or (far) the far arm and leg, faded unless solid. */
function Body({ f, far, front }: { f: Figure; far?: 'solid' | 'faded'; front?: boolean }) {
  const i = far ? 1 : 0
  return (
    <g stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={far === 'faded' ? 0.35 : 1}>
      <path d={chain(f.hips[i], f.knees[i], f.ankles[i], f.toes[i])} />
      <path d={chain(f.shoulders[i], f.elbows[i], f.hands[i])} />
      {!far && (
        <>
          <path d={line(f.hip, f.shoulder)} strokeWidth="6" />
          {front && <path d={line(f.shoulders[0], f.shoulders[1])} strokeWidth="6" />}
          {front && <path d={line(f.hips[0], f.hips[1])} strokeWidth="6" />}
          <circle cx={f.head[0]} cy={f.head[1]} r={BONES.head} fill="var(--ink)" stroke="none" />
        </>
      )}
    </g>
  )
}
function Dumbbell({ at, vertical }: { at: Pt; vertical?: boolean }) {
  return (
    <g transform={`translate(${at[0].toFixed(1)} ${at[1].toFixed(1)}) rotate(${vertical ? 90 : 0})`} fill="var(--moderate)">
      <rect x="-9" y="-1.5" width="18" height="3" rx="1" />
      <rect x="-11" y="-5" width="5" height="10" rx="1.5" />
      <rect x="6" y="-5" width="5" height="10" rx="1.5" />
    </g>
  )
}

function Pack({ f, torso }: { f: Figure; torso: number }) {
  const { center, angle } = packAt(f, torso)
  return <rect x="-6" y="-10" width="12" height="20" rx="3" fill="var(--moderate)" transform={`translate(${center[0].toFixed(1)} ${center[1].toFixed(1)}) rotate(${angle.toFixed(1)})`} />
}
