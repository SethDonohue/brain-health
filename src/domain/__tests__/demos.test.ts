import { describe, expect, it } from 'vitest'
import { BONES, DEMOS, figureAt, FLOOR_Y, ik, phase, videoUrl, type Pt } from '../demos'
import { HOME_WORKOUT } from '../workout.home'

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
const homeVariants = HOME_WORKOUT.exercises.flatMap((ex) => ex.variants.map((v) => ({ ex, v })))

describe('exercise demos', () => {
  it('ik keeps both bones at their length and bends to the chosen side', () => {
    const a = ik([0, 0], [0, 40], 30, 30, -1)
    const b = ik([0, 0], [0, 40], 30, 30, 1)
    expect(dist([0, 0], a)).toBeCloseTo(30)
    expect(dist(a, [0, 40])).toBeCloseTo(30)
    expect(Math.sign(a[0])).toBe(-Math.sign(b[0]))
  })

  it('every drawn demo belongs to a home exercise step', () => {
    const keys = new Set(homeVariants.map((x) => x.v.key))
    for (const k of Object.keys(DEMOS)) expect(keys.has(k), k).toBe(true)
  })

  it('limbs keep their length through the whole rep and nothing goes through the floor', () => {
    for (const [k, demo] of Object.entries(DEMOS)) {
      for (let s = 0; s < 6; s += 0.25) {
        const f = figureAt(demo, s)
        for (const i of [0, 1]) {
          expect(dist(f.hip, f.knees[i]), k).toBeCloseTo(BONES.thigh, 1)
          expect(dist(f.knees[i], f.ankles[i]), k).toBeCloseTo(BONES.shin, 1)
          expect(dist(f.shoulder, f.elbows[i]), k).toBeCloseTo(BONES.upperArm, 1)
          expect(dist(f.elbows[i], f.hands[i]), k).toBeCloseTo(BONES.forearm, 1)
          expect(f.knees[i][1], k).toBeLessThanOrEqual(FLOOR_Y)
        }
        expect(f.head[1] + BONES.head, k).toBeLessThanOrEqual(FLOOR_Y)
      }
    }
  })

  it('a rep goes top → bottom → top', () => {
    const d = DEMOS.bw_squat
    const [down, hold, up, rest] = d.timing
    expect(phase(d, 0)).toBe(0)
    expect(phase(d, down + hold / 2)).toBe(1)
    expect(phase(d, down + hold + up + rest / 2)).toBe(0)
  })

  it('every home step has its own video search, and the link is a YouTube search', () => {
    for (const { ex, v } of homeVariants) {
      const url = videoUrl(ex, v)
      expect(url.startsWith('https://www.youtube.com/results?search_query='), v.key).toBe(true)
      expect(decodeURIComponent(url), v.key).not.toMatch(/exercise how to$/)
    }
    expect(decodeURIComponent(videoUrl({ name: 'Leg press' }, { key: 'imported', name: 'Leg press' }))).toMatch(/Leg press exercise how to$/)
  })
})
