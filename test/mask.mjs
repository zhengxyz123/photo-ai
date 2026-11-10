// Mask preview: dilation and feather must be visible in the selection overlay.
//   node test/mask.mjs [url]
import { Browser, sleep } from './lib/cdp.mjs'
import { dropPhoto } from './lib/photo.mjs'
import { mkdirSync } from 'node:fs'

const URL = process.argv[2] || 'http://127.0.0.1:8177/'
const OUT = 'test/artifacts'
mkdirSync(OUT, { recursive: true })

const browser = await Browser.launch({ width: 1440, height: 900 })
const page = await browser.newPage({ width: 1440, height: 900 })
const errors = []
page.browser.on(page.sessionId, 'Runtime.consoleAPICalled', (p) => {
  if (p.type === 'error') errors.push(p.args?.map((a) => a.value ?? a.description ?? '').join(' '))
})
page.browser.on(page.sessionId, 'Runtime.exceptionThrown', (p) => {
  errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'exception')
})

async function waitFor(desc, fn, timeout = 90000) {
  const t0 = Date.now()
  for (;;) {
    let v
    try { v = await page.eval(fn) } catch { v = null }
    if (v) return v
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + desc)
    await sleep(200)
  }
}
async function shot(name) {
  await sleep(300)
  await page.screenshot({ path: `${OUT}/${name}.png`, format: 'png' })
  console.log('  shot', name)
}
async function drag(x0, y0, x1, y1, steps = 14) {
  const base = { button: 'left', clickCount: 1 }
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, ...base })
  for (let i = 1; i <= steps; i++) {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x0 + ((x1 - x0) * i) / steps),
      y: Math.round(y0 + ((y1 - y0) * i) / steps),
      button: 'left',
    })
    await sleep(30)
  }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, ...base })
}
async function imagePoint(ix, iy) {
  return page.eval(({ ix, iy }) => {
    const r = document.querySelector('.stage-canvas').getBoundingClientRect()
    const v = window.__photoai.view
    return { x: r.left + v.ox + ix * v.scale, y: r.top + v.oy + iy * v.scale }
  }, { ix, iy })
}
async function previewStats() {
  return page.eval(() => {
    const c = window.__photoai.maskCanvas
    const m = window.__photoai.mask
    const d = c.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, c.width, c.height).data
    let outside = 0
    let soft = 0
    let opaque = 0
    const levels = new Set()
    for (let i = 0, p = 3; i < m.length; i++, p += 4) {
      const a = d[p]
      if (!a) continue
      levels.add(a)
      if (!m[i]) outside++
      if (a < 255) soft++
      else opaque++
    }
    let hash = 0
    for (let i = 0; i < m.length; i += 97) hash = (hash * 31 + m[i]) >>> 0
    return {
      w: c.width,
      h: c.height,
      outside,
      soft,
      opaque,
      levels: levels.size,
      hash,
    }
  })
}

try {
  await page.goto(URL, { settleMs: 800 })
  await waitFor('boot', () => !!window.__photoai)
  await dropPhoto(page)
  await waitFor('ready', () => document.querySelector('.status-pill')?.textContent.trim() === '就绪', 90000)
  await page.eval(() => window.__photoai.setTool('box'))
  const a = await imagePoint(120, 180)
  const b = await imagePoint(420, 460)
  await drag(a.x, a.y, b.x, b.y)
  await waitFor('mask', () => !!window.__photoai.mask && !window.__photoai.busy, 60000)

  console.log('[1] no dilation, no feather: preview stays inside the raw mask')
  await page.eval(() => { window.__photoai.setDilate(0); window.__photoai.setFeather(0) })
  await sleep(200)
  const base = await previewStats()
  console.log('   ', JSON.stringify(base))
  if (base.outside !== 0) throw new Error('preview extends outside the mask with no dilation/feather')
  if (base.soft === 0) throw new Error('preview lost its selection tint')
  const rawHash = base.hash

  console.log('[2] dilation extends the visible fill area')
  await page.eval(() => window.__photoai.setDilate(24))
  await sleep(250)
  const dilated = await previewStats()
  console.log('   ', JSON.stringify(dilated))
  if (!(dilated.outside > base.outside + 1000)) throw new Error('dilation is not visible outside the mask')
  if (dilated.hash !== rawHash) throw new Error('dilation mutated the raw mask')

  console.log('[3] feather adds a soft halo')
  await page.eval(() => window.__photoai.setFeather(16))
  await sleep(300)
  const feathered = await previewStats()
  console.log('   ', JSON.stringify(feathered))
  if (!(feathered.outside > dilated.outside)) throw new Error('feather did not extend the soft halo')
  if (feathered.levels < dilated.levels) throw new Error('feather produced no new alpha levels')
  if (feathered.hash !== rawHash) throw new Error('feather mutated the raw mask')

  await page.eval(() => window.__photoai.setDilate(40))
  await sleep(300)
  await shot('mask-preview-dilate-40-feather-16')

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  if (errors.length) process.exitCode = 1
} catch (e) {
  console.error('FAILED:', e.message)
  console.error('page errors:', errors.length ? errors : 'none')
  await shot('mask-preview-failure')
  process.exitCode = 1
} finally {
  await browser.close()
}
