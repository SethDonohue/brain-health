import { z } from 'zod'
import type { ProtocolVersion } from './types'

// Protocol v1, seeded from the Brain Health Protocol spec. Editable as data later (protocol editor, M3).

const weekday = z.number().int().min(1).max(7)
const intensity = z.enum(['light', 'moderate', 'vigorous'])
const activityKey = z.enum(['pickleball', 'strength', 'bike_commute', 'mtb', 'rest'])
const exerciseTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reps'), min: z.number().int().positive(), max: z.number().int().positive() }),
  z.object({ kind: z.literal('hold'), minSec: z.number().int().positive(), maxSec: z.number().int().positive() }),
])

export const ProtocolSchema = z.object({
  version: z.number().int().positive(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  activityTypes: z.array(
    z.object({
      key: activityKey,
      label: z.string().min(1),
      isIntense: z.boolean(),
      isCardio: z.boolean(),
      defaultIntensity: intensity,
    }),
  ),
  weeklyTargets: z.array(
    z.object({
      activityType: activityKey,
      timesPerWeek: z.number().int().min(0).max(7),
      durationMin: z.number().int().min(0),
      durationMax: z.number().int().min(0),
      defaultDays: z.array(weekday),
      slot: z.enum(['am', 'pm']),
      note: z.string(),
    }),
  ),
  workout: z.object({
    sessionTargetMin: z.tuple([z.number(), z.number()]),
    exercises: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        targetSets: z.number().int().positive(),
        variants: z
          .array(z.object({ key: z.string(), name: z.string(), target: exerciseTarget, weighted: z.boolean() }))
          .min(1),
        cue: z.string(),
        muscleGroups: z.array(z.string()),
      }),
    ),
  }),
  sleepRules: z.object({
    caffeineCutoffHours: z.number().positive(),
    exerciseCutoffHours: z.number().positive(),
    showerMinutesBefore: z.number().positive(),
    roomTempC: z.tuple([z.number(), z.number()]),
    checklist: z.array(z.object({ key: z.string(), label: z.string() })),
  }),
  dietGroups: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        kind: z.enum(['do', 'limit']),
        target: z.number().positive(),
        period: z.enum(['day', 'week']),
        unit: z.enum(['serving', 'tbsp', 'glass']),
        servingHint: z.string(),
        optional: z.boolean().optional(),
        atMost: z.boolean().optional(),
      }),
    )
    .length(15),
  mealTemplates: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      servings: z.array(z.object({ dietGroupKey: z.string(), amount: z.number().positive() })),
    }),
  ),
  drinkPresets: z.array(z.object({ key: z.string(), label: z.string(), defaultMg: z.number().min(0) })),
  suggestionRules: z.array(z.string()),
})

export const protocolV1: ProtocolVersion = {
  version: 1,
  effectiveFrom: '2026-11-02',
  activityTypes: [
    { key: 'pickleball', label: 'Pickleball', isIntense: true, isCardio: true, defaultIntensity: 'moderate' },
    { key: 'strength', label: 'Strength', isIntense: true, isCardio: false, defaultIntensity: 'moderate' },
    { key: 'mtb', label: 'Mountain biking', isIntense: true, isCardio: true, defaultIntensity: 'vigorous' },
    { key: 'bike_commute', label: 'Bike commute', isIntense: false, isCardio: true, defaultIntensity: 'moderate' },
    { key: 'rest', label: 'Rest day', isIntense: false, isCardio: false, defaultIntensity: 'light' },
  ],
  weeklyTargets: [
    {
      activityType: 'pickleball',
      timesPerWeek: 4,
      durationMin: 120,
      durationMax: 180,
      defaultDays: [1, 2, 4, 5],
      slot: 'am',
      note: 'Morning or midday. Finish well before the exercise cutoff.',
    },
    {
      activityType: 'strength',
      timesPerWeek: 2,
      durationMin: 45,
      durationMax: 60,
      defaultDays: [2, 4],
      slot: 'pm',
      note: 'Late afternoon, done at least 4 hours before bed.',
    },
    {
      activityType: 'mtb',
      timesPerWeek: 1,
      durationMin: 30,
      durationMax: 45,
      defaultDays: [6],
      slot: 'am',
      note: '30–45 min of mostly uphill effort.',
    },
    {
      activityType: 'rest',
      timesPerWeek: 1,
      durationMin: 0,
      durationMax: 0,
      defaultDays: [7],
      slot: 'am',
      note: 'At least one full rest day. Rest counts as adherence.',
    },
  ],
  workout: {
    sessionTargetMin: [45, 60],
    exercises: [
      {
        key: 'legs',
        name: 'Legs',
        targetSets: 3,
        variants: [
          { key: 'leg_press', name: 'Leg press', target: { kind: 'reps', min: 8, max: 12 }, weighted: true },
          { key: 'squat', name: 'Squat', target: { kind: 'reps', min: 8, max: 12 }, weighted: true },
        ],
        cue: 'Lower for a slow 3 count, then drive up through your heels.',
        muscleGroups: ['quads', 'glutes'],
      },
      {
        key: 'chest',
        name: 'Chest press',
        targetSets: 3,
        variants: [
          { key: 'db_chest_press', name: 'Dumbbell chest press', target: { kind: 'reps', min: 10, max: 12 }, weighted: true },
          { key: 'machine_chest_press', name: 'Machine chest press', target: { kind: 'reps', min: 10, max: 12 }, weighted: true },
        ],
        cue: 'Shoulder blades pinned back and down; control the lowering.',
        muscleGroups: ['chest', 'triceps'],
      },
      {
        key: 'pull',
        name: 'Pull',
        targetSets: 3,
        variants: [
          { key: 'cable_row', name: 'Cable row', target: { kind: 'reps', min: 10, max: 12 }, weighted: true },
          { key: 'lat_pulldown', name: 'Lat pulldown', target: { kind: 'reps', min: 10, max: 12 }, weighted: true },
        ],
        cue: 'Lead with the elbows and squeeze the shoulder blades; no torso swing.',
        muscleGroups: ['back', 'biceps'],
      },
      {
        key: 'hinge',
        name: 'Hinge',
        targetSets: 3,
        variants: [
          { key: 'back_extension', name: 'Back extension', target: { kind: 'reps', min: 12, max: 12 }, weighted: true },
          { key: 'rdl', name: 'Romanian deadlift', target: { kind: 'reps', min: 12, max: 12 }, weighted: true },
        ],
        cue: 'Hinge at the hips with a neutral spine; lower under control.',
        muscleGroups: ['hamstrings', 'lower back'],
      },
      {
        key: 'core',
        name: 'Core',
        targetSets: 3,
        variants: [
          { key: 'plank', name: 'Plank', target: { kind: 'hold', minSec: 45, maxSec: 60 }, weighted: false },
          { key: 'hanging_knee_raise', name: 'Hanging knee raise', target: { kind: 'reps', min: 15, max: 15 }, weighted: false },
        ],
        cue: 'Brace as if about to be poked in the stomach; keep breathing.',
        muscleGroups: ['core'],
      },
    ],
  },
  sleepRules: {
    caffeineCutoffHours: 10,
    exerciseCutoffHours: 4,
    showerMinutesBefore: 90,
    roomTempC: [15, 19],
    checklist: [
      { key: 'dark', label: 'Room dark' },
      { key: 'lights', label: 'Status lights covered' },
      { key: 'temp', label: 'Room cool' },
      { key: 'shower', label: 'Warm shower done' },
      { key: 'caffeine', label: 'Caffeine cutoff kept' },
    ],
  },
  dietGroups: [
    { key: 'leafy_greens', label: 'Leafy greens', kind: 'do', target: 6, period: 'week', unit: 'serving', servingHint: '1 cup raw or ½ cup cooked' },
    { key: 'other_veg', label: 'Other vegetables', kind: 'do', target: 1, period: 'day', unit: 'serving', servingHint: '½ cup' },
    { key: 'berries', label: 'Berries', kind: 'do', target: 2, period: 'week', unit: 'serving', servingHint: '½ cup' },
    { key: 'nuts', label: 'Nuts', kind: 'do', target: 5, period: 'week', unit: 'serving', servingHint: 'A small handful (1 oz)' },
    { key: 'olive_oil', label: 'Olive oil', kind: 'do', target: 1, period: 'day', unit: 'serving', servingHint: 'Tap when olive oil was your main oil today' },
    { key: 'whole_grains', label: 'Whole grains', kind: 'do', target: 3, period: 'day', unit: 'serving', servingHint: '1 slice bread or ½ cup cooked grains' },
    { key: 'fish', label: 'Fish', kind: 'do', target: 1, period: 'week', unit: 'serving', servingHint: '3–4 oz, not fried' },
    { key: 'beans', label: 'Beans', kind: 'do', target: 4, period: 'week', unit: 'serving', servingHint: '½ cup cooked' },
    { key: 'poultry', label: 'Poultry', kind: 'do', target: 2, period: 'week', unit: 'serving', servingHint: '3–4 oz, not fried' },
    { key: 'wine', label: 'Wine', kind: 'do', target: 1, period: 'day', unit: 'glass', servingHint: '5 oz glass; no more than 1 a day', optional: true, atMost: true },
    { key: 'butter', label: 'Butter / margarine', kind: 'limit', target: 1, period: 'day', unit: 'tbsp', servingHint: '1 tbsp' },
    { key: 'cheese', label: 'Cheese', kind: 'limit', target: 1, period: 'week', unit: 'serving', servingHint: '1 oz' },
    { key: 'red_meat', label: 'Red meat', kind: 'limit', target: 3, period: 'week', unit: 'serving', servingHint: '3–4 oz' },
    { key: 'fried', label: 'Fried food', kind: 'limit', target: 1, period: 'week', unit: 'serving', servingHint: '1 portion' },
    { key: 'sweets', label: 'Pastries & sweets', kind: 'limit', target: 4, period: 'week', unit: 'serving', servingHint: '1 pastry, cookie or dessert' },
  ],
  mealTemplates: [
    {
      key: 'breakfast',
      label: 'Breakfast',
      servings: [
        { dietGroupKey: 'whole_grains', amount: 1 },
        { dietGroupKey: 'berries', amount: 1 },
        { dietGroupKey: 'nuts', amount: 1 },
      ],
    },
    {
      key: 'lunch_bowl',
      label: 'Post-pickleball lunch bowl',
      servings: [
        { dietGroupKey: 'leafy_greens', amount: 1 },
        { dietGroupKey: 'whole_grains', amount: 1 },
        { dietGroupKey: 'poultry', amount: 1 },
        { dietGroupKey: 'beans', amount: 1 },
        { dietGroupKey: 'other_veg', amount: 1 },
        { dietGroupKey: 'olive_oil', amount: 1 },
      ],
    },
    {
      key: 'preworkout_snack',
      label: 'Pre-workout snack',
      servings: [
        { dietGroupKey: 'berries', amount: 1 },
        { dietGroupKey: 'nuts', amount: 1 },
      ],
    },
    {
      key: 'green_curry',
      label: 'Thai green curry',
      servings: [
        { dietGroupKey: 'fish', amount: 1 },
        { dietGroupKey: 'other_veg', amount: 1 },
        { dietGroupKey: 'leafy_greens', amount: 1 },
        { dietGroupKey: 'whole_grains', amount: 1 },
      ],
    },
  ],
  drinkPresets: [
    { key: 'brewed_coffee', label: 'Brewed coffee', defaultMg: 95 },
    { key: 'espresso', label: 'Espresso', defaultMg: 63 },
    { key: 'black_tea', label: 'Black tea', defaultMg: 47 },
    { key: 'green_tea', label: 'Green tea', defaultMg: 28 },
    { key: 'cola', label: 'Cola', defaultMg: 34 },
    { key: 'energy_drink', label: 'Energy drink', defaultMg: 80 },
    { key: 'pre_workout', label: 'Pre-workout', defaultMg: 200 },
  ],
  suggestionRules: [],
}

/** Throws if the seed or an edited protocol is malformed. */
export function validateProtocol(p: unknown): ProtocolVersion {
  return ProtocolSchema.parse(p) as ProtocolVersion
}
