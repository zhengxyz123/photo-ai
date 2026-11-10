// View controls: middle-button pan, wheel zoom, and the status bar.
//   node test/view.mjs [url]
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
async function click(x, y, button = 'left') {
  const base = { x: Math.round(x), y: Math.round(y), button, clickCount: 1 }
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
}
async function middleDrag(x0, y0, x1, y1, steps = 12) {
  const base = { button: 'middle', buttons: 4, clickCount: 1 }
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x0), y: Math.round(y0), ...base })
  for (let i = 1; i <= steps; i++) {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x0 + ((x1 - x0) * i) / steps),
      y: Math.round(y0 + ((y1 - y0) * i) / steps),
      button: 'middle',
      buttons: 4,
    })
    await sleep(20)
  }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x1), y: Math.round(y1), ...base })
}
async function wheel(x, y, deltaY) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY })
  await sleep(200)
}
async function state() {
  return page.eval(() => ({
    view: { ...window.__photoai.view },
    doc: window.__photoai.doc,
    layers: window.__photoai.layers,
    tool: window.__photoai.tool,
    mask: !!window.__photoai.mask,
    zoomLabel: document.querySelector('.status-zoom-value')?.textContent.trim(),
  }))
}
async function buttonRect(label) {
  return page.eval((label) => {
    const b = document.querySelector(`.statusbar button[aria-label="${label}"]`)
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, label)
}

try {
  await page.goto(URL, { settleMs: 800 })
  await waitFor('boot', () => !!window.__photoai)
  await dropPhoto(page)
  await waitFor('ready', () => document.querySelector('.status-pill')?.textContent.trim() === '就绪', 90000)
  await sleep(300)

  const start = await state()
  const expectedPct = `${Math.round(start.view.scale * 100)}%`
  console.log('[1] initial', JSON.stringify(start))
  if (start.zoomLabel !== expectedPct) throw new Error(`status zoom ${start.zoomLabel} != ${expectedPct}`)
  if (!(await page.eval(() => !!document.querySelector('.statusbar')))) throw new Error('no status bar')
  await shot('view-initial')

  console.log('[2] middle drag pans the view, not the layer')
  const rect = await page.eval(() => {
    const r = document.querySelector('.stage-canvas').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await middleDrag(rect.x, rect.y, rect.x + 80, rect.y + 42)
  await sleep(250)
  const panned = await state()
  console.log('   ', JSON.stringify(panned))
  if (Math.abs(panned.view.ox - (start.view.ox + 80)) > 2) throw new Error('middle drag did not pan x')
  if (Math.abs(panned.view.oy - (start.view.oy + 42)) > 2) throw new Error('middle drag did not pan y')
  if (JSON.stringify(panned.layers) !== JSON.stringify(start.layers)) throw new Error('middle drag moved a layer')
  if (panned.mask) throw new Error('middle drag started a selection')
  if (panned.tool !== 'point') throw new Error('middle drag changed the tool')

  console.log('[3] middle drag also pans with the move tool')
  await page.eval(() => window.__photoai.setTool('move'))
  await middleDrag(rect.x, rect.y, rect.x - 30, rect.y - 20)
  const movedTool = await state()
  console.log('   ', JSON.stringify(movedTool))
  if (JSON.stringify(movedTool.layers) !== JSON.stringify(start.layers)) throw new Error('middle drag moved the layer')
  if (movedTool.tool !== 'move') throw new Error('tool changed')
  await page.eval(() => window.__photoai.setTool('point'))

  console.log('[4] wheel zooms around the pointer')
  const anchor = { x: rect.x + 60, y: rect.y - 20 }
  const before = await state()
  const beforeIx = (anchor.x - (await page.eval(() => document.querySelector('.stage-canvas').getBoundingClientRect().left)) - before.view.ox) / before.view.scale
  const beforeIy = (anchor.y - (await page.eval(() => document.querySelector('.stage-canvas').getBoundingClientRect().top)) - before.view.oy) / before.view.scale
  await wheel(anchor.x, anchor.y, -160)
  const zoomed = await state()
  const box = await page.eval(() => {
    const r = document.querySelector('.stage-canvas').getBoundingClientRect()
    return { left: r.left, top: r.top }
  })
  const afterIx = (anchor.x - box.left - zoomed.view.ox) / zoomed.view.scale
  const afterIy = (anchor.y - box.top - zoomed.view.oy) / zoomed.view.scale
  console.log('   ', JSON.stringify({ zoomed, anchorImage: [afterIx, afterIy], beforeImage: [beforeIx, beforeIy] }))
  if (!(zoomed.view.scale > before.view.scale)) throw new Error('wheel did not zoom in')
  if (Math.abs(afterIx - beforeIx) > 2 || Math.abs(afterIy - beforeIy) > 2) throw new Error('wheel zoom not anchored')
  if (JSON.stringify(zoomed.layers) !== JSON.stringify(start.layers)) throw new Error('wheel changed a layer')
  if (zoomed.doc.w !== start.doc.w || zoomed.doc.h !== start.doc.h) throw new Error('wheel changed the document')
  await shot('view-zoomed')

  console.log('[5] status bar buttons')
  const out = await buttonRect('减小缩放')
  await click(out.x, out.y)
  await sleep(200)
  const zOut = await state()
  if (!(zOut.view.scale < zoomed.view.scale)) throw new Error('zoom out button failed')
  const inn = await buttonRect('增加缩放')
  await click(inn.x, inn.y)
  await sleep(200)
  const zIn = await state()
  if (!(zIn.view.scale > zOut.view.scale)) throw new Error('zoom in button failed')
  if (zIn.zoomLabel !== `${Math.round(zIn.view.scale * 100)}%`) throw new Error('zoom label did not update')
  const fit = await buttonRect('适应画面')
  await click(fit.x, fit.y)
  await sleep(250)
  const fitted = await state()
  console.log('   ', JSON.stringify({ zOut: zOut.zoomLabel, zIn: zIn.zoomLabel, fit: fitted.zoomLabel }))
  if (Math.abs(fitted.view.scale - start.view.scale) > 0.002) throw new Error('fit button did not restore the fit scale')
  if (JSON.stringify(fitted.layers) !== JSON.stringify(start.layers)) throw new Error('fit changed a layer')
  await shot('view-fitted')

  console.log('[6] zoom past 100% (nearest-neighbour sampling)')
  await wheel(rect.x, rect.y, -400)
  const near = await state()
  console.log('   ', JSON.stringify({ scale: near.view.scale, label: near.zoomLabel }))
  if (!(near.view.scale > 1)) throw new Error('did not zoom past 100%')
  if (near.zoomLabel !== `${Math.round(near.view.scale * 100)}%`) throw new Error('zoom label wrong at 100%+')
  await shot('view-nearest')

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  if (errors.length) process.exitCode = 1
} catch (e) {
  console.error('FAILED:', e.message)
  console.error('page errors:', errors.length ? errors : 'none')
  await shot('view-failure')
  process.exitCode = 1
} finally {
  await browser.close()
}
