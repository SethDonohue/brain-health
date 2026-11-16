import type { Exercise, ExerciseTarget, ProtocolVersion } from './types'

// The home strength plan (Project doc "strength-plan.md"): two full-body workouts with no exercise in common.
// A (Tuesday) is heavier, 6–10 reps; B (Thursday) is lighter, 10–15+ reps. Exercises run in pairs: alternate a
// set of one with a set of the next. Each exercise's variations go from easiest to hardest; move on when every
// set reaches the top of the range.

const reps = (min: number, max: number): ExerciseTarget => ({ kind: 'reps', min, max })
const hold = (minSec: number, maxSec: number): ExerciseTarget => ({ kind: 'hold', minSec, maxSec })

const workoutA: Exercise[] = [
  {
    key: 'a_split_squat',
    name: 'Split squat',
    day: 'A',
    targetSets: 3,
    variants: [
      { key: 'split_squat', name: 'Split squat', target: reps(8, 12), weighted: false },
      { key: 'bulgarian', name: 'Bulgarian', target: reps(8, 12), weighted: false },
      { key: 'bulgarian_db', name: 'Bulgarian + DB', target: reps(6, 10), weighted: true },
    ],
    cue: 'Reps are per leg. Bulgarian: back foot on the couch. Lower until the back knee nearly touches, front knee over the toes. Pair: alternate sets with chin-ups.',
    muscleGroups: ['quads', 'glutes'],
  },
  {
    key: 'a_chin_up',
    name: 'Chin-up',
    day: 'A',
    targetSets: 3,
    variants: [
      { key: 'band_pulldown', name: 'Band pulldown', target: reps(8, 12), weighted: false },
      { key: 'chin_negative', name: 'Negatives', target: reps(3, 6), weighted: false },
      { key: 'chin_up', name: 'Chin-up', target: reps(5, 10), weighted: false },
    ],
    cue: 'Palms facing you. Start from a dead hang, pull elbows down to your pockets until your chin clears the bar. Negatives: jump up, lower for 3–5 s.',
    muscleGroups: ['back', 'biceps'],
  },
  {
    key: 'a_decline_push_up',
    name: 'Decline push-up',
    day: 'A',
    targetSets: 3,
    variants: [
      { key: 'push_up', name: 'Push-up', target: reps(8, 15), weighted: false },
      { key: 'decline_push_up', name: 'Feet on couch', target: reps(6, 12), weighted: false },
      { key: 'decline_loaded', name: 'Loaded', target: reps(6, 10), weighted: true },
    ],
    cue: 'Body in one straight line, elbows about 45° from your sides, chest to an inch off the floor. Loaded: a backpack or band across your back. Pair: alternate sets with single-leg RDLs.',
    muscleGroups: ['chest', 'shoulders', 'triceps'],
  },
  {
    key: 'a_sl_rdl',
    name: 'Single-leg RDL',
    day: 'A',
    targetSets: 3,
    variants: [
      { key: 'sl_rdl_wall', name: 'Hand on wall', target: reps(8, 12), weighted: false },
      { key: 'sl_rdl', name: 'Free-standing', target: reps(8, 12), weighted: false },
      { key: 'sl_rdl_db', name: 'Dumbbell', target: reps(6, 10), weighted: true },
    ],
    cue: 'Reps are per leg. Hinge at the hip with a soft knee, back leg reaching behind, hips square. Lower until you feel the hamstring stretch.',
    muscleGroups: ['hamstrings', 'glutes'],
  },
  {
    key: 'a_overhead_press',
    name: 'Overhead press',
    day: 'A',
    targetSets: 3,
    variants: [
      { key: 'pike_push_up', name: 'Pike push-up', target: reps(6, 12), weighted: false },
      { key: 'db_overhead_press', name: 'Dumbbell', target: reps(6, 10), weighted: true },
    ],
    cue: 'Ribs down, squeeze your glutes, press straight up until the arms lock out by your ears. Pike: hips high, head toward the floor. Pair: alternate sets with hamstring curls.',
    muscleGroups: ['shoulders', 'triceps'],
  },
  {
    key: 'a_hamstring_curl',
    name: 'Hamstring curl',
    day: 'A',
    targetSets: 3,
    variants: [
      { key: 'slider_curl', name: 'Both legs', target: reps(6, 10), weighted: false },
      { key: 'slider_curl_single', name: 'One leg', target: reps(6, 10), weighted: false },
    ],
    cue: 'Lie on your back, heels on a towel on a smooth floor, hips up. Pull the heels in, then slide them out slowly while keeping the hips up.',
    muscleGroups: ['hamstrings'],
  },
  {
    key: 'a_side_plank',
    name: 'Side plank',
    day: 'A',
    targetSets: 2,
    variants: [
      { key: 'side_plank_knees', name: 'Knees down', target: hold(30, 45), weighted: false },
      { key: 'side_plank', name: 'Full', target: hold(30, 45), weighted: false },
    ],
    cue: 'Hold each side. Elbow under the shoulder, body in a straight line, don’t let the hips sag. Pair: alternate with calf raises.',
    muscleGroups: ['core'],
  },
  {
    key: 'a_calf_raise',
    name: 'Calf raise',
    day: 'A',
    targetSets: 2,
    variants: [
      { key: 'calf_raise', name: 'Bodyweight', target: reps(12, 20), weighted: false },
      { key: 'calf_raise_db', name: 'Dumbbell', target: reps(8, 12), weighted: true },
    ],
    cue: 'One leg at a time on a stair edge. Full stretch at the bottom, pause at the top. Good for the Achilles in pickleball.',
    muscleGroups: ['calves'],
  },
]

const workoutB: Exercise[] = [
  {
    key: 'b_squat',
    name: 'Squat',
    day: 'B',
    targetSets: 3,
    variants: [
      { key: 'bw_squat', name: 'Bodyweight', target: reps(15, 20), weighted: false },
      { key: 'goblet_squat', name: 'Goblet', target: reps(10, 15), weighted: true },
    ],
    cue: 'Take 3 s on the way down, chest up, knees track over the toes, at least thighs parallel. Goblet: hold one dumbbell at your chest. Pair: alternate sets with rows.',
    muscleGroups: ['quads', 'glutes'],
  },
  {
    key: 'b_row',
    name: 'Row',
    day: 'B',
    targetSets: 3,
    variants: [
      { key: 'band_row', name: 'Band', target: reps(12, 15), weighted: false },
      { key: 'db_row', name: 'Dumbbell', target: reps(10, 15), weighted: true },
    ],
    cue: 'Dumbbell: one hand on a chair, back flat, reps per arm. Lead with the elbow toward your hip and squeeze the shoulder blade; no torso swing.',
    muscleGroups: ['back', 'biceps'],
  },
  {
    key: 'b_chest_press',
    name: 'Push-up or floor press',
    day: 'B',
    targetSets: 3,
    variants: [
      { key: 'incline_push_up', name: 'Incline', target: reps(10, 15), weighted: false },
      { key: 'floor_push_up', name: 'Floor', target: reps(10, 15), weighted: false },
      { key: 'db_floor_press', name: 'Floor press', target: reps(10, 15), weighted: true },
    ],
    cue: 'Incline: hands on a counter. Control the lowering, elbows about 45° from your sides. Floor press: lie on your back, upper arms touch the floor. Pair: alternate sets with hip thrusts.',
    muscleGroups: ['chest', 'shoulders', 'triceps'],
  },
  {
    key: 'b_hip_thrust',
    name: 'Hip thrust',
    day: 'B',
    targetSets: 3,
    variants: [
      { key: 'glute_bridge', name: 'Glute bridge', target: reps(12, 20), weighted: false },
      { key: 'sl_bridge', name: 'One leg', target: reps(10, 15), weighted: false },
      { key: 'hip_thrust_db', name: 'Dumbbell', target: reps(10, 15), weighted: true },
    ],
    cue: 'Drive through your heels until the hips are fully straight, pause and squeeze for a second. Dumbbell: shoulders on the couch, weight on your hips. One leg: reps per leg.',
    muscleGroups: ['glutes', 'hamstrings'],
  },
  {
    key: 'b_lateral_raise',
    name: 'Lateral raise',
    day: 'B',
    targetSets: 3,
    variants: [{ key: 'db_lateral_raise', name: 'Lateral raise', target: reps(12, 20), weighted: true }],
    cue: 'Light dumbbells, slight bend in the elbows, raise out to the sides only to shoulder height. Safer for the shoulders than upright rows. Pair: alternate sets with face pulls.',
    muscleGroups: ['shoulders'],
  },
  {
    key: 'b_face_pull',
    name: 'Face pull',
    day: 'B',
    targetSets: 3,
    variants: [
      { key: 'prone_y_raise', name: 'Prone Y raise', target: reps(12, 15), weighted: false },
      { key: 'band_face_pull', name: 'Band', target: reps(12, 20), weighted: false },
    ],
    cue: 'Band anchored at face height: pull toward your eyes, elbows high, rotating the hands back. Prone Y: face down, raise thumbs-up arms in a Y. Keeps pickleball shoulders healthy.',
    muscleGroups: ['upper back', 'shoulders'],
  },
  {
    key: 'b_plank',
    name: 'Plank',
    day: 'B',
    targetSets: 2,
    variants: [
      { key: 'plank', name: 'Plank', target: hold(30, 60), weighted: false },
      { key: 'long_plank', name: 'Long plank', target: hold(30, 45), weighted: false },
    ],
    cue: 'Brace as if about to be poked in the stomach, squeeze your glutes, keep breathing. Long plank: elbows further forward. Pair: alternate with the Pallof press.',
    muscleGroups: ['core'],
  },
  {
    key: 'b_pallof',
    name: 'Pallof press',
    day: 'B',
    targetSets: 2,
    variants: [{ key: 'pallof_press', name: 'Pallof press', target: reps(10, 12), weighted: false }],
    cue: 'Reps are per side. Band anchored at chest height beside you. Press straight out and hold 2 s without letting it twist you. Trains the core for pickleball swings.',
    muscleGroups: ['core'],
  },
]

export const HOME_WORKOUT: ProtocolVersion['workout'] = {
  sessionTargetMin: [50, 60],
  days: [
    { key: 'A', name: 'Workout A', note: 'Heavier, 6–10 reps: single-leg and up-and-down moves' },
    { key: 'B', name: 'Workout B', note: 'Lighter, 10–15+ reps: two-leg and front-to-back moves' },
  ],
  exercises: [...workoutA, ...workoutB],
}
