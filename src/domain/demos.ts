import type { Exercise, ExerciseVariant } from './types'

// Exercise demos: an original stick figure that loops one rep, plus a link to example videos.
// A pose sets the hip, the torso angle, the feet and the hands; knees and elbows are worked out from the bone
// lengths (two-bone IK), so limbs keep their length while the figure moves between the two poses.

export type Pt = [number, number]

/** Bone lengths in viewBox units (the default box is 200 × 140, floor at y = 128). */
export const BONES = { thigh: 30, shin: 30, torso: 36, upperArm: 22, forearm: 22, neck: 5, head: 7 }
export const FLOOR_Y = 128
export const VIEW: View = [0, 0, 200, 140]
/** Front view: how far each shoulder and hip sits from the middle. */
const FRONT = { shoulder: 11, hip: 6 }

export type View = [x: number, y: number, w: number, h: number]

export interface Pose {
  hip: Pt
  /** torso direction from hip to shoulder, degrees clockwise from straight up (90 = facing right, lying flat) */
  torso: number
  /** head direction from the shoulder, if not in line with the torso (e.g. −90 lying on your back) */
  neck?: number
  /** ankles: [near leg, far leg] */
  ankles: [Pt, Pt]
  /** toe tips: [near, far] */
  toes: [Pt, Pt]
  /** hands: [near, far]; relative to that shoulder (true) or to the hip ('hip') when set */
  hands: [Pt, Pt]
  handsRel?: boolean | 'hip'
  /** the shoulder stays planted between the two poses (the hip swings around it) */
  pivot?: 'shoulder'
}

export type Prop =
  /** a couch, bench, step, counter or wall */
  | { kind: 'box'; x: number; y: number; w: number; h: number }
  /** dumbbells: in the hands (both shown in a front view) */
  | { kind: 'dumbbells'; vertical?: boolean }
  /** a loaded backpack on the back */
  | { kind: 'pack' }
  /** a pull-up bar seen end-on */
  | { kind: 'bar'; at: Pt }
  /** a resistance band from an anchor to the near hand */
  | { kind: 'band'; from: Pt }
  /** a door frame or post the band is tied to, drawn behind the figure */
  | { kind: 'post'; x: number; top: number }
  /** a towel or slider under the near heel */
  | { kind: 'slider' }

export interface Demo {
  /** the resting pose the rep starts from */
  top: Pose
  /** the other end of the rep */
  bottom: Pose
  /** bend direction per limb: +1 or −1 (which side of the root→end line the knee or elbow goes) */
  knees: [1 | -1, 1 | -1]
  elbows: [1 | -1, 1 | -1]
  props: Prop[]
  /** seconds: going to the other end, pause there, coming back, pause at rest */
  timing: [number, number, number, number]
  /** facing the viewer (both sides drawn in full) instead of side-on, facing right */
  front?: boolean
  /** draw the far arm and leg in full, not faded (when the far arm shows something) */
  farSolid?: boolean
  /** a bigger box for tall moves (keep the 10:7 shape) */
  view?: View
}

export interface Figure {
  hip: Pt
  shoulder: Pt
  head: Pt
  /** where each leg and arm starts: the same as hip and shoulder side-on, apart in a front view */
  hips: [Pt, Pt]
  shoulders: [Pt, Pt]
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
const toDeg = (r: number) => (r * 180) / Math.PI
/** Direction from a to b in pose degrees. */
export const angleOf = (a: Pt, b: Pt) => toDeg(Math.atan2(b[0] - a[0], -(b[1] - a[1])))
export const shoulderOf = (hip: Pt, torso: number): Pt => add(hip, dir(torso), BONES.torso)

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
  const torso = lerp(a.torso, b.torso, t)
  const hip = a.pivot === 'shoulder' ? add(lerpPt(shoulderOf(a.hip, a.torso), shoulderOf(b.hip, b.torso), t), dir(torso), -BONES.torso) : lerpPt(a.hip, b.hip, t)
  return {
    hip,
    torso,
    neck: a.neck == null && b.neck == null ? undefined : lerp(a.neck ?? a.torso, b.neck ?? b.torso, t),
    ankles: [lerpPt(a.ankles[0], b.ankles[0], t), lerpPt(a.ankles[1], b.ankles[1], t)],
    toes: [lerpPt(a.toes[0], b.toes[0], t), lerpPt(a.toes[1], b.toes[1], t)],
    hands: [lerpPt(a.hands[0], b.hands[0], t), lerpPt(a.hands[1], b.hands[1], t)],
    handsRel: a.handsRel,
    pivot: a.pivot,
  }
}

export function solve(p: Pose, demo: Pick<Demo, 'knees' | 'elbows' | 'front'>): Figure {
  const B = BONES
  const shoulder = shoulderOf(p.hip, p.torso)
  const head = add(shoulder, dir(p.neck ?? p.torso), B.neck + B.head)
  const sw = demo.front ? FRONT.shoulder : 0
  const hw = demo.front ? FRONT.hip : 0
  const hips: [Pt, Pt] = [[p.hip[0] + hw, p.hip[1]], [p.hip[0] - hw, p.hip[1]]]
  const shoulders: [Pt, Pt] = [[shoulder[0] + sw, shoulder[1]], [shoulder[0] - sw, shoulder[1]]]
  const ankles = [0, 1].map((i) => reach(hips[i], p.ankles[i], B.thigh + B.shin)) as [Pt, Pt]
  const hands = [0, 1].map((i) => {
    const base = p.handsRel === 'hip' ? p.hip : p.handsRel ? shoulders[i] : null
    return reach(shoulders[i], base ? add(base, p.hands[i]) : p.hands[i], B.upperArm + B.forearm)
  }) as [Pt, Pt]
  return {
    hip: p.hip,
    shoulder,
    head,
    hips,
    shoulders,
    ankles,
    toes: p.toes,
    knees: [0, 1].map((i) => ik(hips[i], ankles[i], B.thigh, B.shin, demo.knees[i])) as [Pt, Pt],
    hands,
    elbows: [0, 1].map((i) => ik(shoulders[i], hands[i], B.upperArm, B.forearm, demo.elbows[i])) as [Pt, Pt],
  }
}

/** Where in the rep a time falls: 0 = rest pose, 1 = the other end, eased. */
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

// ── Pose helpers ───────────────────────────────────────────────────────────────────────────────────────
// Side-on figures face right. Knee bend −1 sends the knee forward on a downward leg; elbow bend +1 sends the
// elbow back on a downward arm. Each demo was checked by drawing both ends (see the tests for the rules).

const F = FLOOR_Y
const TALL: View = [-14, -20, 228, 160]
const armsDown: [Pt, Pt] = [[3, 43], [1, 43]]

/** A straight body from a planted ankle (or knee) up to a shoulder at height y, facing right. */
function straight(foot: Pt, shoulderY: number, legs = BONES.thigh + BONES.shin): { hip: Pt; torso: number; shoulder: Pt } {
  const body = legs + BONES.torso
  const dy = shoulderY - foot[1]
  const dx = Math.sqrt(body * body - dy * dy)
  return { hip: [foot[0] + (dx * legs) / body, foot[1] + (dy * legs) / body], torso: toDeg(Math.atan2(dx, -dy)), shoulder: [foot[0] + dx, shoulderY] }
}

/** A hip swung around a planted shoulder: a = direction from the shoulder to the hip. */
function hipFrom(shoulder: Pt, a: number): { hip: Pt; torso: number } {
  return { hip: add(shoulder, dir(a), BONES.torso), torso: a > 0 ? a - 180 : a + 180 }
}

// ── Workout A ──────────────────────────────────────────────────────────────────────────────────────────

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

/** Hanging from a bar: up = chin over the bar. */
function chinUp(negative: boolean): Demo {
  const bar: Pt = [104, -2]
  const hang = (shoulder: Pt, hip: Pt): Pose => ({
    hip,
    torso: angleOf(hip, shoulder),
    ankles: [add(hip, [-16, 46]), add(hip, [-19, 45])],
    toes: [add(hip, [-19, 52]), add(hip, [-22, 51])],
    hands: [bar, [bar[0] - 1, bar[1]]],
  })
  const down = hang([97, 40], [94, 76])
  const up = hang([94, 2], [88, 38])
  return {
    top: negative ? up : down,
    bottom: negative ? down : up,
    knees: [-1, -1],
    elbows: [1, 1],
    props: [{ kind: 'bar', at: bar }],
    // negatives: lower slowly for 3–5 s, then jump back up
    timing: negative ? [4, 0.4, 0.7, 0.6] : [1.1, 0.4, 1.6, 0.7],
    view: [-14, -28, 228, 160],
  }
}

/** Kneeling, pulling a band down from the top of a door. */
function bandPulldown(): Demo {
  const anchor: Pt = [108, -12]
  const pose = (torso: number, hands: Pt): Pose => ({ hip: [92, 95], torso, ankles: [[62, F - 4], [60, F - 4]], toes: [[55, F - 2], [53, F - 2]], hands: [hands, [hands[0] - 1, hands[1]]], handsRel: true })
  return {
    top: pose(2, [8, -42]),
    bottom: pose(-6, [14, -4]),
    knees: [-1, -1],
    elbows: [1, 1],
    props: [{ kind: 'post', x: 112, top: -14 }, { kind: 'band', from: anchor }],
    timing: [1.2, 0.5, 1.6, 0.5],
    view: TALL,
  }
}

function pushUp(opts: { ankle: Pt; toe: Pt; hand: Pt; up: number; down: number; props?: Prop[]; loaded?: boolean }): Demo {
  // A straight body pivots on the toes; the hands stay planted.
  const at = (shoulderY: number): Pose => {
    const { hip, torso } = straight(opts.ankle, shoulderY)
    return { hip, torso, ankles: [opts.ankle, opts.ankle], toes: [opts.toe, opts.toe], hands: [opts.hand, [opts.hand[0] - 1, opts.hand[1]]] }
  }
  return {
    top: at(opts.up),
    bottom: at(opts.down),
    knees: [-1, -1],
    elbows: [1, 1],
    props: [...(opts.props ?? []), ...(opts.loaded ? [{ kind: 'pack' } as Prop] : [])],
    timing: [1.4, 0.2, 1.0, 0.6],
  }
}

const floorPushUp = () => pushUp({ ankle: [42, F - 5], toe: [38, F], hand: [126, F], up: F - 44, down: F - 19 })
const couchPushUp = (loaded: boolean) =>
  pushUp({ ankle: [42, 90], toe: [38, 94], hand: [130, F], up: F - 44, down: F - 19, props: [{ kind: 'box', x: 18, y: 94, w: 38, h: F - 94 }], loaded })

/** Single-leg Romanian deadlift: hinge on the near leg, the far leg reaches back. */
function singleLegRdl(variant: 'wall' | 'free' | 'db'): Demo {
  const ankle: Pt = [100, F - 3]
  const toe: Pt = [111, F]
  const pose = (hip: Pt, torso: number, far: Pt, farToe: Pt, wallHand: Pt): Pose => {
    const s = shoulderOf(hip, torso)
    const hang = add(s, [2, 43])
    return { hip, torso, ankles: [ankle, far], toes: [toe, farToe], hands: [variant === 'wall' ? wallHand : hang, add(s, [0, 43])] }
  }
  return {
    top: pose([97, 68], 2, [86, F - 10], [80, F - 6], [136, 58]),
    bottom: pose([88, 72], 82, [31, 80], [29, 87], [138, 84]),
    knees: [-1, -1],
    elbows: [1, 1],
    props: [...(variant === 'wall' ? [{ kind: 'box', x: 140, y: 20, w: 6, h: F - 20 } as Prop] : []), ...(variant === 'db' ? [{ kind: 'dumbbells' } as Prop] : [])],
    timing: [1.6, 0.4, 1.2, 0.6],
  }
}

/** Pike push-up: hips high, head down between the hands. */
function pikePushUp(): Demo {
  const ankle: Pt = [54, F - 6]
  const toe: Pt = [50, F]
  const hand: Pt = [128, F]
  const pose = (hip: Pt, torso: number): Pose => ({ hip, torso, ankles: [ankle, ankle], toes: [toe, toe], hands: [hand, [hand[0] - 1, hand[1]]] })
  return {
    top: pose([82, 70], 128),
    bottom: pose([90, 76], 140),
    knees: [-1, -1],
    elbows: [1, 1],
    props: [],
    timing: [1.4, 0.2, 1.0, 0.6],
  }
}

function dbOverheadPress(): Demo {
  const pose = (hands: Pt): Pose => ({ hip: [97, 67], torso: 0, ankles: [[100, F - 3], [96, F - 3]], toes: [[111, F], [107, F]], hands: [hands, [hands[0] - 1, hands[1]]], handsRel: true })
  return {
    top: pose([8, -4]),
    bottom: pose([2, -44]),
    knees: [-1, -1],
    elbows: [1, 1],
    props: [{ kind: 'dumbbells' }],
    timing: [1.0, 0.4, 1.4, 0.5],
    view: TALL,
  }
}

/** Lying on your back, heels on a towel, hips up: pull the heels in. */
function sliderCurl(single: boolean): Demo {
  const shoulder: Pt = [50, F - 8]
  const pose = (a: number, heelX: number): Pose => {
    const { hip, torso } = hipFrom(shoulder, a)
    const raised = add(hip, dir(a - 60), 58)
    return {
      hip,
      torso,
      neck: -90,
      ankles: [[heelX, F - 4], single ? raised : [heelX - 2, F - 4]],
      toes: [[heelX + 3, F - 12], single ? add(raised, dir(a - 150), 8) : [heelX + 1, F - 12]],
      hands: [[95, F - 2], [95, F - 2]],
      pivot: 'shoulder',
    }
  }
  return {
    top: pose(76, 145),
    bottom: pose(54, 116),
    knees: [-1, -1],
    elbows: [1, 1],
    props: [{ kind: 'slider' }],
    timing: [1.2, 0.3, 2.0, 0.5],
  }
}

/** Side plank on the near forearm, seen from the front; the top arm reaches up. A hold: lift, then stay. */
function sidePlank(knees: boolean): Demo {
  const foot: Pt = knees ? [78, F - 3] : [44, F - 4]
  const { shoulder } = straight(foot, F - 24, knees ? BONES.thigh : BONES.thigh + BONES.shin)
  const hand: Pt = [shoulder[0] + 22, F - 2]
  const ankle: Pt = knees ? [56, 106] : foot
  const toe: Pt = knees ? [50, 103] : [foot[0] - 2, F]
  const pose = (a: number): Pose => {
    const { hip, torso } = hipFrom(shoulder, a)
    return { hip, torso, ankles: [ankle, ankle], toes: [toe, toe], hands: [hand, add(shoulder, [2, -43])], pivot: 'shoulder' }
  }
  const lifted = angleOf(shoulder, foot)
  return {
    top: pose(lifted),
    bottom: pose(lifted - (knees ? 10 : 22)),
    knees: [-1, -1],
    elbows: [1, 1],
    props: [],
    timing: [0.9, 0.5, 0.9, 3],
    farSolid: true,
  }
}

/** Single-leg calf raise with the toes on a step; heel drops below the edge. */
function calfRaise(dumbbell: boolean): Demo {
  const toe: Pt = [106, 110]
  const pose = (ankle: Pt): Pose => {
    const hip = add(ankle, [-1, -58])
    const s = shoulderOf(hip, 0)
    return { hip, torso: 0, ankles: [ankle, add(hip, [-20, 46])], toes: [toe, add(hip, [-26, 48])], hands: [add(s, [3, 43]), [146, s[1] + 10]] }
  }
  return {
    top: pose([99, 98]),
    bottom: pose([95, 114]),
    knees: [-1, 1],
    elbows: [1, -1],
    props: [{ kind: 'box', x: 100, y: 110, w: 70, h: F - 110 }, { kind: 'box', x: 150, y: -14, w: 6, h: 124 }, ...(dumbbell ? [{ kind: 'dumbbells' } as Prop] : [])],
    timing: [1.2, 0.8, 1.0, 1.0],
    view: TALL,
  }
}

// ── Workout B ──────────────────────────────────────────────────────────────────────────────────────────

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

/** Seated on the floor, band around the feet, pull the hands to the waist. */
function bandRow(): Demo {
  const pose = (torso: number, hands: Pt): Pose => ({
    hip: [66, F - 6],
    torso,
    ankles: [[124, F - 4], [122, F - 4]],
    toes: [[128, F - 12], [126, F - 12]],
    hands: [hands, [hands[0] - 1, hands[1]]],
    handsRel: true,
  })
  return {
    top: pose(4, [40, 22]),
    bottom: pose(-6, [8, 26]),
    knees: [-1, -1],
    elbows: [-1, -1],
    props: [{ kind: 'band', from: [127, F - 9] }],
    timing: [1.0, 0.6, 1.4, 0.5],
  }
}

/** One-arm dumbbell row: far hand on a chair, back flat, near arm rows. */
function dbRow(): Demo {
  const hip: Pt = [72, 70]
  const torso = 75
  const s = shoulderOf(hip, torso)
  const pose = (hand: Pt): Pose => ({ hip, torso, ankles: [[66, F - 3], [94, F - 3]], toes: [[77, F], [105, F]], hands: [add(s, hand), [128, 88]] })
  return {
    top: pose([0, 43]),
    bottom: pose([-16, 20]),
    knees: [-1, -1],
    elbows: [1, -1],
    props: [{ kind: 'box', x: 120, y: 88, w: 44, h: F - 88 }, { kind: 'dumbbells' }],
    timing: [1.0, 0.5, 1.4, 0.5],
  }
}

const inclinePushUp = () => pushUp({ ankle: [36, F - 5], toe: [32, F], hand: [120, 84], up: 50, down: 68, props: [{ kind: 'box', x: 116, y: 84, w: 54, h: F - 84 }] })

/** Lying on your back, knees bent: press the dumbbells up from the floor. */
function dbFloorPress(): Demo {
  const pose = (hands: Pt): Pose => ({
    hip: [96, F - 8],
    torso: -90,
    neck: -90,
    ankles: [[126, F - 3], [124, F - 3]],
    toes: [[136, F], [134, F]],
    hands: [hands, [hands[0] - 1, hands[1]]],
    handsRel: true,
  })
  return {
    top: pose([2, -44]),
    bottom: pose([20, -20]),
    knees: [-1, -1],
    elbows: [1, 1],
    props: [{ kind: 'dumbbells' }],
    timing: [1.4, 0.3, 1.0, 0.5],
  }
}

/** Glute bridge from the floor (or shoulders on the couch for the dumbbell hip thrust). */
function bridge(variant: 'floor' | 'single' | 'db'): Demo {
  const couch = variant === 'db'
  const shoulder: Pt = couch ? [54, 84] : [50, F - 8]
  const ankle: Pt = couch ? [112, F - 3] : [106, F - 3]
  const pose = (a: number): Pose => {
    const { hip, torso } = hipFrom(shoulder, a)
    const raised = add(hip, dir(45 + a * 0.3), 58)
    return {
      hip,
      torso,
      neck: couch ? -70 : -90,
      ankles: [ankle, variant === 'single' ? raised : [ankle[0] - 2, ankle[1]]],
      toes: [[ankle[0] + 10, F], variant === 'single' ? add(raised, dir(a * 0.3 - 45), 8) : [ankle[0] + 8, F]],
      hands: couch ? [[0, -6], [-1, -6]] : [[95, F - 2], [95, F - 2]],
      handsRel: couch ? 'hip' : undefined,
      pivot: 'shoulder',
    }
  }
  return {
    top: pose(couch ? angleOf(shoulder, [74, 114]) : 90),
    bottom: pose(couch ? 90 : angleOf(shoulder, [73, 92])),
    knees: [-1, -1],
    elbows: couch ? [-1, -1] : [1, 1],
    props: couch ? [{ kind: 'box', x: 18, y: 88, w: 40, h: F - 88 }, { kind: 'dumbbells' }] : [],
    timing: [1.0, 1.0, 1.4, 0.5],
  }
}

/** Seen from the front: raise the dumbbells out to the sides to shoulder height. */
function lateralRaise(): Demo {
  const pose = (near: Pt): Pose => ({
    hip: [100, 67],
    torso: 0,
    ankles: [[106, F - 3], [94, F - 3]],
    toes: [[110, F], [90, F]],
    hands: [near, [-near[0], near[1]]],
    handsRel: true,
  })
  return {
    top: pose([6, 43]),
    bottom: pose([42, 4]),
    knees: [-1, 1],
    elbows: [1, -1],
    props: [{ kind: 'dumbbells', vertical: true }],
    timing: [1.0, 0.5, 1.6, 0.6],
    front: true,
  }
}

/** Band anchored at face height in front: pull toward the eyes, elbows high. */
function bandFacePull(): Demo {
  const pose = (hands: Pt): Pose => ({ hip: [92, 68], torso: -6, ankles: [[100, F - 3], [84, F - 3]], toes: [[111, F], [95, F]], hands: [hands, [hands[0] - 1, hands[1]]], handsRel: true })
  return {
    top: pose([43, -8]),
    bottom: pose([8, -16]),
    knees: [-1, -1],
    elbows: [-1, -1],
    props: [{ kind: 'post', x: 182, top: 8 }, { kind: 'band', from: [180, 24] }],
    timing: [1.0, 0.6, 1.4, 0.5],
  }
}

/** Face down: raise straight arms off the floor in a Y. */
function proneYRaise(): Demo {
  const pose = (hands: Pt): Pose => ({ hip: [66, F - 8], torso: 90, ankles: [[8, F - 4], [9, F - 4]], toes: [[5, F], [6, F]], hands: [hands, hands], handsRel: true })
  return {
    top: pose([43, 5]),
    bottom: pose([41, -14]),
    knees: [1, 1],
    elbows: [1, 1],
    props: [],
    timing: [1.0, 1.0, 1.2, 0.6],
  }
}

/** Forearm plank (a hold): lift the hips into one straight line, then stay. */
function plank(long: boolean): Demo {
  const ankle: Pt = [34, F - 5]
  const toe: Pt = [30, F]
  const forward = long ? 14 : 0
  const { shoulder } = straight(ankle, F - 2 - Math.sqrt(22 * 22 - forward * forward))
  const elbow: Pt = [shoulder[0] + forward, F - 2]
  const hand: Pt = [elbow[0] + 22, F - 2]
  const pose = (a: number): Pose => {
    const { hip, torso } = hipFrom(shoulder, a)
    return { hip, torso, ankles: [ankle, ankle], toes: [toe, toe], hands: [hand, [hand[0] - 1, hand[1]]], pivot: 'shoulder' }
  }
  const lifted = angleOf(shoulder, ankle)
  return {
    top: pose(lifted),
    bottom: pose(lifted - 14),
    knees: [-1, -1],
    elbows: [-1, -1],
    props: [],
    timing: [0.9, 0.5, 0.9, 3],
  }
}

/** Band anchored beside you at chest height: press straight out and hold. */
function pallofPress(): Demo {
  const pose = (hands: Pt): Pose => ({ hip: [98, 72], torso: 4, ankles: [[106, F - 3], [90, F - 3]], toes: [[117, F], [101, F]], hands: [hands, [hands[0] - 1, hands[1]]], handsRel: true })
  return {
    top: pose([16, 20]),
    bottom: pose([43, 14]),
    knees: [-1, -1],
    elbows: [1, 1],
    props: [{ kind: 'post', x: 94, top: 30 }, { kind: 'band', from: [94, 54] }],
    timing: [1.0, 2.0, 1.0, 0.6],
  }
}

/** Drawn demos by variant key. Variants not listed here only get the video link. */
export const DEMOS: Record<string, Demo> = {
  split_squat: splitSquat(false, false),
  bulgarian: splitSquat(true, false),
  bulgarian_db: splitSquat(true, true),
  band_pulldown: bandPulldown(),
  chin_negative: chinUp(true),
  chin_up: chinUp(false),
  push_up: floorPushUp(),
  decline_push_up: couchPushUp(false),
  decline_loaded: couchPushUp(true),
  sl_rdl_wall: singleLegRdl('wall'),
  sl_rdl: singleLegRdl('free'),
  sl_rdl_db: singleLegRdl('db'),
  pike_push_up: pikePushUp(),
  db_overhead_press: dbOverheadPress(),
  slider_curl: sliderCurl(false),
  slider_curl_single: sliderCurl(true),
  side_plank_knees: sidePlank(true),
  side_plank: sidePlank(false),
  calf_raise: calfRaise(false),
  calf_raise_db: calfRaise(true),
  bw_squat: squat(false),
  goblet_squat: squat(true),
  band_row: bandRow(),
  db_row: dbRow(),
  incline_push_up: inclinePushUp(),
  floor_push_up: floorPushUp(),
  db_floor_press: dbFloorPress(),
  glute_bridge: bridge('floor'),
  sl_bridge: bridge('single'),
  hip_thrust_db: bridge('db'),
  db_lateral_raise: lateralRaise(),
  prone_y_raise: proneYRaise(),
  band_face_pull: bandFacePull(),
  plank: plank(false),
  long_plank: plank(true),
  pallof_press: pallofPress(),
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
