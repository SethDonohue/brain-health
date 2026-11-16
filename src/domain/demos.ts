import type { Exercise, ExerciseVariant } from './types'

// Exercise demos: an original side-view stick figure that loops one rep, plus a link to example videos.
// A pose sets the hip, the torso angle, the feet and the hands; knees and elbows are worked out from the bone
// lengths (two-bone IK), so limbs keep their length while the figure moves between the top and bottom poses.

export type Pt = [number, number]

/** Bone lengths in viewBox units (the box is 200 × 140, floor at y = 128). */
export const BONES = { thigh: 30, shin: 30, torso: 36, upperArm: 22, forearm: 22, neck: 5, head: 7 }
export const FLOOR_Y = 128

export interface Pose {
  hip: Pt
  /** torso direction from hip to shoulder, degrees clockwise from straight up (90 = facing right, lying flat) */
  torso: number
  /** ankles: [near leg, far leg] */
  ankles: [Pt, Pt]
  /** toe tips: [near, far] */
  toes: [Pt, Pt]
  /** hands: [near, far]; relative to the shoulder when handsRel is set */
  hands: [Pt, Pt]
  handsRel?: boolean
}

export type Prop =
  /** a couch, bench or step */
  | { kind: 'box'; x: number; y: number; w: number; h: number }
  /** dumbbells in both hands */
  | { kind: 'dumbbells'; vertical?: boolean }
  /** a loaded backpack on the back */
  | { kind: 'pack' }

export interface Demo {
  top: Pose
  bottom: Pose
  /** bend direction per limb: +1 or −1 (which side of the hip→ankle line the knee goes) */
  knees: [1 | -1, 1 | -1]
  elbows: [1 | -1, 1 | -1]
  props: Prop[]
  /** seconds: lowering, pause at the bottom, rising, pause at the top */
  timing: [number, number, number, number]
}

export interface Figure {
  hip: Pt
  shoulder: Pt
  head: Pt
  knees: [Pt, Pt]
  ankles: [Pt, Pt]
  toes: [Pt, Pt]
  elbows: [Pt, Pt]
  hands: [Pt, Pt]
}

const dir = (deg: number): Pt => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180)]
const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + b[0] * k, a[1] + b[1] * k]
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpPt = (a: Pt, b: Pt, t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]

/** The middle joint of a two-bone limb from root to end; bend picks the side. Out of reach: straight toward the end. */
export function ik(root: Pt, end: Pt, l1: number, l2: number, bend: 1 | -1): Pt {
  const dx = end[0] - root[0]
  const dy = end[1] - root[1]
  const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6)
  const a = Math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))
  const th = Math.atan2(dy, dx) + bend * a
  return [root[0] + l1 * Math.cos(th), root[1] + l1 * Math.sin(th)]
}

/** Clamp an end point to the limb's reach, so a straight limb never stretches. */
function reach(root: Pt, end: Pt, len: number): Pt {
  const d = Math.hypot(end[0] - root[0], end[1] - root[1])
  return d <= len ? end : lerpPt(root, end, len / d)
}

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  return {
    hip: lerpPt(a.hip, b.hip, t),
    torso: lerp(a.torso, b.torso, t),
    ankles: [lerpPt(a.ankles[0], b.ankles[0], t), lerpPt(a.ankles[1], b.ankles[1], t)],
    toes: [lerpPt(a.toes[0], b.toes[0], t), lerpPt(a.toes[1], b.toes[1], t)],
    hands: [lerpPt(a.hands[0], b.hands[0], t), lerpPt(a.hands[1], b.hands[1], t)],
    handsRel: a.handsRel,
  }
}

export function solve(p: Pose, demo: Pick<Demo, 'knees' | 'elbows'>): Figure {
  const B = BONES
  const shoulder = add(p.hip, dir(p.torso), B.torso)
  const head = add(shoulder, dir(p.torso), B.neck + B.head)
  const legs = B.thigh + B.shin
  const arms = B.upperArm + B.forearm
  const ankles = p.ankles.map((a) => reach(p.hip, a, legs)) as [Pt, Pt]
  const hands = p.hands.map((h) => reach(shoulder, p.handsRel ? add(shoulder, h) : h, arms)) as [Pt, Pt]
  return {
    hip: p.hip,
    shoulder,
    head,
    ankles,
    toes: p.toes,
    knees: [ik(p.hip, ankles[0], B.thigh, B.shin, demo.knees[0]), ik(p.hip, ankles[1], B.thigh, B.shin, demo.knees[1])],
    hands,
    elbows: [ik(shoulder, hands[0], B.upperArm, B.forearm, demo.elbows[0]), ik(shoulder, hands[1], B.upperArm, B.forearm, demo.elbows[1])],
  }
}

/** Where in the rep a time falls: 0 = top, 1 = bottom, eased. */
export function phase(demo: Pick<Demo, 'timing'>, sec: number): number {
  const [down, hold, up, rest] = demo.timing
  const total = down + hold + up + rest
  let t = ((sec % total) + total) % total
  const ease = (x: number) => (1 - Math.cos(Math.PI * x)) / 2
  if (t < down) return ease(t / down)
  t -= down
  if (t < hold) return 1
  t -= hold
  if (t < up) return 1 - ease(t / up)
  return 0
}

export function figureAt(demo: Demo, sec: number): Figure {
  return solve(blendPose(demo.top, demo.bottom, phase(demo, sec)), demo)
}

/** Where a backpack sits: on the back, halfway up the torso. */
export function packAt(f: Figure, torso: number): { center: Pt; angle: number } {
  const mid = lerpPt(f.hip, f.shoulder, 0.55)
  const r = (torso * Math.PI) / 180
  return { center: [mid[0] - Math.cos(r) * 6, mid[1] - Math.sin(r) * 6], angle: torso }
}

// ── Poses ──────────────────────────────────────────────────────────────────────────────────────────────
// The figure faces right. Knee bend −1 sends the knee forward on a downward leg; elbow bend +1 sends the elbow back.

const F = FLOOR_Y
const armsDown: [Pt, Pt] = [[3, 43], [1, 43]]

function splitSquat(rearOnCouch: boolean, dumbbells: boolean): Demo {
  const couch: Prop = { kind: 'box', x: 24, y: 98, w: 34, h: F - 98 }
  const rearAnkle: Pt = rearOnCouch ? [56, 94] : [68, F - 6]
  const rearToe: Pt = rearOnCouch ? [47, 98] : [62, F]
  const front: Pt = rearOnCouch ? [126, F - 3] : [120, F - 3]
  const frontToe: Pt = [front[0] + 10, F]
  const hipX = rearOnCouch ? 100 : 94
  const pose = (hip: Pt, torso: number): Pose => ({ hip, torso, ankles: [front, rearAnkle], toes: [frontToe, rearToe], hands: armsDown, handsRel: true })
  return {
    top: pose([hipX, 73], rearOnCouch ? 8 : 4),
    bottom: pose([hipX - 6, rearOnCouch ? 99 : 97], rearOnCouch ? 14 : 6),
    knees: [-1, -1],
    elbows: [1, 1],
    props: [...(rearOnCouch ? [couch] : []), ...(dumbbells ? [{ kind: 'dumbbells' } as Prop] : [])],
    timing: [1.6, 0.3, 1.2, 0.6],
  }
}

function pushUp(feetUp: boolean, loaded: boolean): Demo {
  // A straight body pivots on the toes; the hands stay planted under the shoulders.
  const ankle: Pt = feetUp ? [42, 90] : [42, F - 5]
  const toe: Pt = feetUp ? [38, 94] : [38, F]
  const hand: Pt = [feetUp ? 130 : 126, F]
  const body = BONES.thigh + BONES.shin + BONES.torso
  const at = (shoulderY: number): Pose => {
    const dy = shoulderY - ankle[1]
    const dx = Math.sqrt(body * body - dy * dy)
    const torso = (Math.atan2(dx, -dy) * 180) / Math.PI
    const legs = BONES.thigh + BONES.shin
    const hip: Pt = [ankle[0] + (dx * legs) / body, ankle[1] + (dy * legs) / body]
    return { hip, torso, ankles: [ankle, ankle], toes: [toe, toe], hands: [hand, [hand[0] - 1, hand[1]]] }
  }
  return {
    top: at(F - 44),
    bottom: at(F - 19),
    knees: [-1, -1],
    elbows: [1, 1],
    props: [...(feetUp ? [{ kind: 'box', x: 18, y: 94, w: 38, h: F - 94 } as Prop] : []), ...(loaded ? [{ kind: 'pack' } as Prop] : [])],
    timing: [1.4, 0.2, 1.0, 0.6],
  }
}

function squat(goblet: boolean): Demo {
  const ankle: Pt = [100, F - 3]
  const toe: Pt = [111, F]
  const hands: [Pt, Pt] = goblet ? [[13, 10], [12, 10]] : [[40, 10], [39, 10]]
  const pose = (hip: Pt, torso: number): Pose => ({ hip, torso, ankles: [ankle, [ankle[0] - 2, ankle[1]]], toes: [toe, [toe[0] - 2, toe[1]]], hands, handsRel: true })
  return {
    top: pose([97, 67], 3),
    bottom: pose([80, 101], 38),
    knees: [-1, -1],
    elbows: [1, 1],
    props: goblet ? [{ kind: 'dumbbells', vertical: true }] : [],
    timing: [2.6, 0.3, 1.2, 0.6],
  }
}

/** Drawn demos by variant key. Variants not listed here only get the video link for now. */
export const DEMOS: Record<string, Demo> = {
  split_squat: splitSquat(false, false),
  bulgarian: splitSquat(true, false),
  bulgarian_db: splitSquat(true, true),
  push_up: pushUp(false, false),
  decline_push_up: pushUp(true, false),
  decline_loaded: pushUp(true, true),
  floor_push_up: pushUp(false, false),
  bw_squat: squat(false),
  goblet_squat: squat(true),
}

// ── Video examples ─────────────────────────────────────────────────────────────────────────────────────

/** Search words for the example-video link, by variant key. */
const VIDEO_SEARCH: Record<string, string> = {
  split_squat: 'split squat how to',
  bulgarian: 'bulgarian split squat bodyweight how to',
  bulgarian_db: 'dumbbell bulgarian split squat how to',
  band_pulldown: 'resistance band lat pulldown how to',
  chin_negative: 'negative chin up how to',
  chin_up: 'chin up proper form',
  push_up: 'push up proper form',
  decline_push_up: 'decline push up how to',
  decline_loaded: 'weighted backpack decline push up',
  sl_rdl_wall: 'single leg romanian deadlift wall assisted',
  sl_rdl: 'single leg romanian deadlift bodyweight how to',
  sl_rdl_db: 'dumbbell single leg romanian deadlift how to',
  pike_push_up: 'pike push up how to',
  db_overhead_press: 'standing dumbbell overhead press form',
  slider_curl: 'towel slider hamstring curl how to',
  slider_curl_single: 'single leg slider hamstring curl',
  side_plank_knees: 'modified side plank on knees',
  side_plank: 'side plank proper form',
  calf_raise: 'single leg calf raise on step',
  calf_raise_db: 'dumbbell single leg calf raise on step',
  bw_squat: 'bodyweight squat proper form',
  goblet_squat: 'goblet squat how to',
  band_row: 'resistance band row how to',
  db_row: 'one arm dumbbell row how to',
  incline_push_up: 'incline push up on counter',
  floor_push_up: 'push up proper form',
  db_floor_press: 'dumbbell floor press how to',
  glute_bridge: 'glute bridge how to',
  sl_bridge: 'single leg glute bridge how to',
  hip_thrust_db: 'dumbbell hip thrust on couch',
  db_lateral_raise: 'dumbbell lateral raise proper form',
  prone_y_raise: 'prone Y raise how to',
  band_face_pull: 'resistance band face pull how to',
  plank: 'plank proper form',
  long_plank: 'long lever plank how to',
  pallof_press: 'band pallof press how to',
}

/** A YouTube search for the move, so a broken or removed video never leaves a dead link. */
export function videoUrl(ex: Pick<Exercise, 'name'>, v: Pick<ExerciseVariant, 'key' | 'name'>): string {
  const q = VIDEO_SEARCH[v.key] ?? (v.name === ex.name ? `${ex.name} exercise how to` : `${ex.name} ${v.name} exercise how to`)
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
}
