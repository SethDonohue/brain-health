/* Layout checks: runs every tab and the main sheets across phone widths, text sizes and themes,
 * and reports horizontal overflow, clipped or wrapped headings, overlapping text, small tap targets
 * and content hidden behind the footer.
 *
 *   npx vite build && npx vite preview --port 4173 &     # serve the build
 *   node e2e/layout.cjs [outDir] [--quick]              # --quick: fewer combinations
 *   SCALES=200 node e2e/layout.cjs                      # the largest Android text size (report only)
 *
 * Text size is emulated by scaling the root font size (the app uses rem), which is what Android's
 * Font size setting does to a WebView. Capacitor's system-bar insets are emulated with the same CSS
 * variables the SystemBars plugin sets.
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '..', 'layout-out')
const QUICK = process.argv.includes('--quick')
const URL = process.env.URL || 'http://localhost:4173/'
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'

const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : QUICK ? [320, 412] : [320, 360, 393, 412, 430]
const HEIGHTS = { 320: 640, 360: 740, 393: 852, 412: 892, 430: 932 }
const SCALES = process.env.SCALES ? process.env.SCALES.split(',').map(Number) : QUICK ? [100, 150] : [100, 130, 150]
const SCHEMES = QUICK ? ['light'] : ['light', 'dark']
const INSETS = { top: 32, bottom: 48 }

const TABS = ['Today', 'Sleep', 'Eat', 'Train', 'Week']
// [tab, button name regex, label]. Missing triggers are reported, not fatal.
const SHEETS = [
  ['Today', /^Log activity$/, 'log-activity'],
  ['Today', /^Settings$/, 'settings'],
  ['Sleep', /^Bedtime/, 'bedtime'],
  ['Sleep', /Edit drinks and amounts/, 'drinks'],
  ['Eat', /^Edit my targets$/, 'edit-targets'],
  ['Eat', /^About these bands$/, 'mind-about'],
  ['Eat', /^Edit meals$/, 'edit-meals'],
  ['Train', /^Add a session on/, 'add-session'],
  ['Train', /^Import/, 'import'],
  ['Train', /^Pickleball, 5–7 PM/, 'planned-timed'],
]

const findings = []
const missing = new Set()
const note = (ctx, kind, detail) => findings.push({ ctx, kind, detail })

/** Runs in the page: returns a list of problems for what is currently on screen. */
function inspect({ footerSelector }) {
  const out = []
  const vw = window.innerWidth
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
  }
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ')
    return `${el.tagName.toLowerCase()} "${t.slice(0, 50)}"`
  }
  // inside a scroller that is meant to scroll sideways (chart strips etc.)
  const inHScroller = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX
      if ((o === 'auto' || o === 'scroll') && n.scrollWidth > n.clientWidth) return true
    }
    return false
  }

  if (document.documentElement.scrollWidth > vw + 1) out.push(['overflow-x', `page is ${document.documentElement.scrollWidth}px wide in a ${vw}px window`])

  // with a sheet open, only the sheet is checked; the page behind it is covered by its backdrop
  const root = document.querySelector('[role="dialog"]') || document.body
  const all = [...root.querySelectorAll('*')].filter(vis)
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if ((r.right > vw + 1 || r.left < -1) && !inHScroller(el) && !el.closest('[aria-hidden="true"]')) out.push(['off-screen', `${label(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`])
    const cs = getComputedStyle(el)
    if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1 && el.children.length === 0 && el.textContent.trim())
      out.push(['clipped-text', `${label(el)} is cut off (${el.scrollWidth}px of text in ${el.clientWidth}px)`])
  }

  // text that should sit on one line but wraps (count distinct line tops of the text itself)
  const lineCount = (el) => {
    const tops = new Set()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(t)
      for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top / 4))
    }
    return tops.size
  }
  for (const el of root.querySelectorAll('nav button, [role="tab"], [data-oneline]')) {
    if (!vis(el) || el.hasAttribute('data-multiline')) continue
    // buttons that stack a number over a word (sleep rating) are intentionally two lines
    const kids = [...el.children].filter((c) => c.textContent.trim())
    const n = kids.length > 1 ? Math.max(...kids.map(lineCount)) : lineCount(el)
    if (n > 1) out.push(['wrapped', `${label(el)} wraps to ${n} lines`])
  }

  // text leaves that overlap each other (partial overlap, neither contains the other)
  const leaves = all.filter((el) => el.children.length === 0 && el.textContent.trim() && !el.closest('svg'))
  // one box per rendered line of text, so an inline span that wraps is not one big rectangle
  const boxes = []
  for (const el of leaves) for (const r of el.getClientRects()) if (r.width > 0 && r.height > 0) boxes.push({ el, r })
  let reported = 0
  for (let i = 0; i < boxes.length && reported < 8; i++) {
    for (let j = i + 1; j < boxes.length && reported < 8; j++) {
      if (boxes[i].el === boxes[j].el) continue
      const a = boxes[i].r
      const b = boxes[j].r
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      // glyph boxes of different sizes on neighbouring lines can touch by a few px; ignore small vertical contact
      if (w > 3 && h > 6 && !boxes[i].el.contains(boxes[j].el) && !boxes[j].el.contains(boxes[i].el)) {
        // different layers (a fixed footer, a sticky save bar) slide over content on purpose
        const layer = (e) => {
          for (let n = e; n; n = n.parentElement) {
            const pos = getComputedStyle(n).position
            if (pos === 'fixed' || pos === 'sticky') return n
          }
          return null
        }
        if (layer(boxes[i].el) !== layer(boxes[j].el)) continue
        out.push(['overlap', `${label(boxes[i].el)} overlaps ${label(boxes[j].el)} by ${Math.round(w)}x${Math.round(h)}px`])
        reported++
      }
    }
  }

  // tap targets
  for (const el of root.querySelectorAll('button, a[href], [role="button"], input, select, [role="switch"], [role="radio"]')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    if (r.height < 43.5 || r.width < 43.5) {
      // an input inside a labelled row or a visually-hidden control is covered by its label
      if (el.closest('label') && el.closest('label').getBoundingClientRect().height >= 43.5) continue
      // seven weekday buttons cannot all be 44px wide on a 320px phone: allow 34px wide when tall enough
      if (el.closest('[data-small-ok]') && r.width >= 32 && r.height >= 44) continue
      out.push(['tap-target', `${label(el)} is ${Math.round(r.width)}x${Math.round(r.height)}px`])
    }
  }
  return out
}

async function footerClearance(p) {
  // scroll to the bottom; the last visible content must end above the footer
  return p.evaluate((sel) => {
    const f = document.querySelector(sel)
    if (!f) return null
    window.scrollTo(0, document.documentElement.scrollHeight)
    const top = f.getBoundingClientRect().top
    const main = document.querySelector('main')
    if (!main) return null
    let bottom = 0
    for (const el of main.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && el.children.length === 0 && el.textContent.trim()) bottom = Math.max(bottom, r.bottom)
    }
    return bottom > top ? `last content ends at ${Math.round(bottom)}px, footer starts at ${Math.round(top)}px` : null
  }, 'div.fixed.bottom-0')
}

async function onboard(p) {
  await p.goto(URL)
  await p.waitForTimeout(500)
  for (let i = 0; i < 4; i++) {
    const b = p.locator('button:has-text("I understand"), button:has-text("Next"), button:has-text("Start")').last()
    if (!(await b.count())) break
    await b.click()
    await p.waitForTimeout(200)
  }
  await p.getByRole('button', { name: 'Commute leg' }).waitFor({ timeout: 8000 })
}

/** Gives every tab something to show: servings, a logged ride, a sleep log. Best effort. */
async function seed(p) {
  const tryTap = async (re, n = 1) => {
    for (let i = 0; i < n; i++) {
      const b = p.getByRole('button', { name: re }).first()
      if (await b.count()) await b.click({ timeout: 2000 }).catch(() => {})
    }
  }
  await tryTap(/^Commute leg/, 2)
  await p.waitForTimeout(300)
  await goTab(p, 'Eat')
  await tryTap(/^Leafy greens:/, 4)
  await tryTap(/^Berries:/, 2)
  await tryTap(/^Red meat:/, 3)
  await tryTap(/^Pastries & sweets:/, 1)
  await tryTap(/^Butter/, 3)
  await tryTap(/^Olive oil/, 2)
  // a booked session with a time range, so plan chips are checked at their longest
  await p.reload() // clears the Eat toasts, which can cover the buttons below (data stays)
  await p.getByRole('button', { name: 'Commute leg' }).waitFor({ timeout: 8000 }).catch(() => {})
  await goTab(p, 'Train')
  for (const re of [/^Add a session on/, /^\+ Add a time/, /^2 h$/, /^Pickleball$/]) {
    await tryTap(re)
    await p.waitForTimeout(350) // let the sheet open
  }
  await p.waitForTimeout(300)
  await goTab(p, 'Today')
}

async function goTab(p, name) {
  await p.locator('nav[aria-label=Main] button', { hasText: name }).click()
  await p.waitForTimeout(250)
  await p.evaluate(() => window.scrollTo(0, 0))
}

async function closeSheet(p) {
  // the header "Close" has text; the full-screen backdrop behind it only has an aria-label
  const close = p.locator('[role="dialog"] button:has-text("Close")').first()
  if (await close.count()) await close.click({ timeout: 2000, force: true }).catch(() => {})
  await p.waitForTimeout(200)
  if (await p.locator('[role="dialog"]').count()) await p.mouse.click(5, 5).catch(() => {})
  await p.waitForTimeout(150)
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: CHROME })
  let combos = 0
  for (const scheme of SCHEMES) {
    for (const width of WIDTHS) {
      for (const scale of SCALES) {
        const ctx = await browser.newContext({ viewport: { width, height: HEIGHTS[width] }, deviceScaleFactor: 1, colorScheme: scheme })
        const p = await ctx.newPage()
        p.on('pageerror', (e) => note(`${width}px`, 'page-error', e.message))
        await p.addInitScript(
          ({ scale, insets }) => {
            const css = `:root{--safe-area-inset-top:${insets.top}px;--safe-area-inset-bottom:${insets.bottom}px}html{font-size:${scale}% !important}`
            const add = () => {
              const s = document.createElement('style')
              s.textContent = css
              document.documentElement.appendChild(s)
            }
            if (document.documentElement) add()
            else document.addEventListener('DOMContentLoaded', add)
          },
          { scale, insets: INSETS },
        )
        const tag = `${scheme} ${width}px ${scale}%`
        combos++
        try {
          await onboard(p)
          await seed(p)
          for (const tab of TABS) {
            await goTab(p, tab)
            const c = `${tag} / ${tab}`
            for (const [kind, detail] of await p.evaluate(inspect, {})) note(c, kind, detail)
            const fc = await footerClearance(p)
            if (fc) note(c, 'footer-clearance', fc)
            if (scale === 100 || scale === 200 || process.env.SHOTS) await p.screenshot({ path: path.join(OUT, `${scheme}-${width}-${scale}-${tab}.png`) })
          }
          for (const [tab, re, name] of SHEETS) {
            await goTab(p, tab)
            const b = p.getByRole('button', { name: re }).first()
            if (!(await b.count())) {
              missing.add(`${tab}: ${name}`)
              continue
            }
            await b.scrollIntoViewIfNeeded().catch(() => {})
            await b.click({ timeout: 3000, force: true }).catch(() => {})
            await p.waitForTimeout(300)
            const c = `${tag} / sheet ${name}`
            for (const [kind, detail] of await p.evaluate(inspect, {})) note(c, kind, detail)
            if (scale === 100 || scale === 200 || process.env.SHOTS) await p.screenshot({ path: path.join(OUT, `${scheme}-${width}-${scale}-sheet-${name}.png`) })
            await closeSheet(p)
          }
        } catch (e) {
          note(tag, 'harness-error', String(e.message).split('\n')[0])
        }
        await ctx.close()
      }
    }
  }
  await browser.close()

  // collapse duplicates across combinations: same kind + detail text, list where it happened
  const groups = new Map()
  for (const f of findings) {
    const key = `${f.kind}|${f.detail.replace(/\d+(\.\d+)?px/g, 'Npx').replace(/\d+ lines/, 'N lines')}`
    if (!groups.has(key)) groups.set(key, { kind: f.kind, detail: f.detail, where: [] })
    groups.get(key).where.push(f.ctx)
  }
  const lines = [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind))
  for (const g of lines) console.log(`${g.kind.toUpperCase().padEnd(16)} ${g.detail}\n    first: ${g.where[0]}   (${g.where.length} combos)`)
  if (missing.size) console.log(`\nSheets not found (skipped): ${[...missing].join(', ')}`)
  console.log(`\n${combos} combinations, ${findings.length} findings in ${lines.length} distinct problems. Screenshots: ${OUT}`)
  fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify(lines, null, 2))
  process.exit(lines.length ? 1 : 0)
}

run().catch((e) => {
  console.error(e)
  process.exit(2)
})
