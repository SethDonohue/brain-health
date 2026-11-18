import { describe, expect, it } from 'vitest'
import { BONES, DEMOS, figureAt, FLOOR_Y, ik, phase, videoUrl, VIEW, type Pt } from '../demos'
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

  it('every home exercise step has a drawing, and every drawing belongs to a step', () => {
    const keys = new Set(homeVariants.map((x) => x.v.key))
    for (const k of Object.keys(DEMOS)) expect(keys.has(k), k).toBe(true)
    for (const k of keys) expect(DEMOS[k], k).toBeDefined()
  })

  it('limbs keep their length through the whole rep, nothing goes through the floor, and it all stays in view', () => {
    for (const [k, demo] of Object.entries(DEMOS)) {
      const [vx, vy, vw, vh] = demo.view ?? VIEW
      expect(vw / vh, k).toBeCloseTo(200 / 140, 1)
      const total = demo.timing.reduce((a, b) => a + b, 0)
      for (let s = 0; s <= total; s += 0.2) {
        const f = figureAt(demo, s)
        for (const i of [0, 1]) {
          expect(dist(f.hips[i], f.knees[i]), k).toBeCloseTo(BONES.thigh, 1)
          expect(dist(f.knees[i], f.ankles[i]), k).toBeCloseTo(BONES.shin, 1)
          expect(dist(f.shoulders[i], f.elbows[i]), k).toBeCloseTo(BONES.upperArm, 1)
          expect(dist(f.elbows[i], f.hands[i]), k).toBeCloseTo(BONES.forearm, 1)
          for (const p of [f.knees[i], f.ankles[i], f.toes[i], f.elbows[i], f.hands[i]]) expect(p[1], `${k} below the floor`).toBeLessThanOrEqual(FLOOR_Y + 0.5)
        }
        expect(f.head[1] + BONES.head, k).toBeLessThanOrEqual(FLOOR_Y + 0.5)
        const pts = [f.head, f.hip, f.shoulder, ...f.knees, ...f.ankles, ...f.toes, ...f.elbows, ...f.hands]
        for (const p of pts) {
          expect(p[0], `${k} off the left/right`).toBeGreaterThanOrEqual(vx + 2)
          expect(p[0], `${k} off the left/right`).toBeLessThanOrEqual(vx + vw - 2)
          expect(p[1], `${k} off the top`).toBeGreaterThanOrEqual(vy + 2)
        }
        expect(f.head[1] - BONES.head, `${k} head off the top`).toBeGreaterThanOrEqual(vy)
      }
    }
  })

  it('a planted shoulder stays put through the rep', () => {
    for (const [k, demo] of Object.entries(DEMOS)) {
      if (demo.top.pivot !== 'shoulder') continue
      const a = figureAt(demo, 0).shoulder
      const b = figureAt(demo, demo.timing[0] / 2).shoulder
      expect(dist(a, b), k).toBeLessThan(0.5)
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
