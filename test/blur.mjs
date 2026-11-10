// Blur-unselected: dialog preview, cancel, confirm, undo, and config placement.
//   node test/blur.mjs [url]
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
async function click(x, y) {
  const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
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
async function selectBox() {
  await page.eval(() => window.__photoai.setTool('box'))
  const a = await imagePoint(120, 180)
  const b = await imagePoint(420, 460)
  await drag(a.x, a.y, b.x, b.y)
  await waitFor('mask', () => !!window.__photoai.mask && !window.__photoai.busy, 60000)
  await page.eval(() => { window.__photoai.setDilate(0); window.__photoai.setFeather(0) })
  await sleep(200)
}

async function buttonRect(label, root = 'document') {
  return page.eval(({ label, root }) => {
    const scope = root === 'document' ? document : document.querySelector(root)
    if (!scope) return null
    const b = [...scope.querySelectorAll('button')].find((x) => x.textContent.trim().includes(label))
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, { label, root })
}
async function previewStats() {
  return page.eval(() => {
    const orig = window.__photoai.activeCanvas
    const pv = window.__photoai.blurPreview
    const m = window.__photoai.mask
    if (!orig || !pv?.canvas || !m) return null
    const w = orig.width
    const h = orig.height
    const a = orig.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, w, h).data
    const b = pv.canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, w, h).data
    let insideDiff = 0
    let outsideDiff = 0
    let inside = 0
    let outside = 0
    let diff = 0
    let hashA = 0
    let hashB = 0
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      hashA = (hashA * 31 + a[p] + a[p + 1] * 3 + a[p + 2] * 7 + a[p + 3] * 11) >>> 0
      hashB = (hashB * 31 + b[p] + b[p + 1] * 3 + b[p + 2] * 7 + b[p + 3] * 11) >>> 0
      const changed = a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2] || a[p + 3] !== b[p + 3]
      if (changed) diff++
      if (m[i]) {
        inside++
        if (changed) insideDiff++
      } else {
        outside++
        if (changed) outsideDiff++
      }
    }
    return { w, h, inside, outside, insideDiff, outsideDiff, diff, hashA, hashB }
  })
}
async function layerHash() {
  return page.eval(() => {
    const c = window.__photoai.activeCanvas
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data
    let h = 0
    for (let p = 0; p < d.length; p += 4) h = (h * 31 + d[p] + d[p + 1] * 3 + d[p + 2] * 7 + d[p + 3] * 11) >>> 0
    return h
  })
}

try {
  await page.goto(URL, { settleMs: 800 })
  await waitFor('boot', () => !!window.__photoai)
  await dropPhoto(page)
  await waitFor('ready', () => document.querySelector('.status-pill')?.textContent.trim() === '就绪', 90000)

  const noSelection = await page.eval(() => {
    const b = document.querySelector('.blur-open-btn')
    return b ? { disabled: b.closest('button')?.disabled || b.disabled || b.getAttribute('aria-disabled') } : null
  })
  console.log('[0] blur button before selection', JSON.stringify(noSelection))

  await selectBox()
  const originalHash = await layerHash()

  console.log('[1] open the dialog and show a live preview')
  const open = await buttonRect('模糊未选区域')
  if (!open) throw new Error('no blur button')
  await click(open.x, open.y)
  await waitFor('blur dialog', () => !!document.querySelector('.blur-dialog') && !!window.__photoai.blurPreview)
  const low = await previewStats()
  console.log('   ', JSON.stringify({ low, originalHash }))
  if (!low) throw new Error('no preview stats')
  if (!(low.outsideDiff > 1000)) throw new Error('outside selection is not blurred')
  if (low.insideDiff !== 0) throw new Error('inside selection changed')
  if (low.hashA !== originalHash) throw new Error('original layer changed during preview')
  await shot('blur-preview')

  console.log('[1b] Escape cancels the preview and clears the selection (documented behavior)')
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor('dialog closed by Escape', () => !document.querySelector('.blur-dialog'))
  await sleep(250)
  const esc = await page.eval(() => ({
    mask: !!window.__photoai.mask,
    preview: !!window.__photoai.blurPreview,
  }))
  console.log('   ', JSON.stringify(esc))
  if (esc.mask) throw new Error('Escape should clear the selection')
  if (esc.preview) throw new Error('Escape left the blur preview active')
  if (await layerHash() !== originalHash) throw new Error('Escape committed the blur')

  // Re-select the same box; the dialog is closed, so a new selection is the
  // documented way to get back to a blur.
  await selectBox()

  const openAgain = await buttonRect('模糊未选区域')
  await click(openAgain.x, openAgain.y)
  await waitFor('blur dialog reopened', () => !!document.querySelector('.blur-dialog') && !!window.__photoai.blurPreview)

  console.log('[2] slider changes the preview in real time')
  const slider = await page.eval(() => {
    const r = document.querySelector('.blur-dialog .n-slider').getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })
  await click(slider.left + slider.width * 0.82, slider.top + slider.height / 2)
  await sleep(600)
  const label = await page.eval(() => document.querySelector('.blur-field output')?.textContent.trim())
  const high = await previewStats()
  console.log('   slider', label, JSON.stringify({ high }))
  if (label === '12 px' || !label) throw new Error('slider did not change')
  if (!(high.diff > low.diff)) throw new Error('larger strength did not increase the preview difference')
  await shot('blur-preview-strong')

  console.log('[3] cancel leaves the layer untouched')
  const cancel = await buttonRect('取消', '.blur-dialog')
  await click(cancel.x, cancel.y)
  await waitFor('dialog closed', () => !document.querySelector('.blur-dialog'))
  await sleep(300)
  const afterCancel = await layerHash()
  const previewGone = await page.eval(() => !window.__photoai.blurPreview)
  console.log('   ', JSON.stringify({ afterCancel, originalHash, previewGone }))
  if (afterCancel !== originalHash) throw new Error('cancel changed the layer')
  if (!previewGone) throw new Error('preview was not cleared')

  console.log('[4] confirm commits the blur, undo restores it')
  await selectBox()
  const open2 = await buttonRect('模糊未选区域')
  await click(open2.x, open2.y)
  await waitFor('blur dialog again', () => !!document.querySelector('.blur-dialog') && !!window.__photoai.blurPreview)
  const confirm = await buttonRect('确认', '.blur-dialog')
  await click(confirm.x, confirm.y)
  await waitFor('dialog closed after confirm', () => !document.querySelector('.blur-dialog'))
  await sleep(700)
  const committed = await layerHash()
  console.log('   committed', committed)
  if (committed === originalHash) throw new Error('confirm did not commit the blur')
  await shot('blur-committed')
  await page.eval(() => window.__photoai.undo())
  await waitFor('undo done', () => !window.__photoai.busy, 60000)
  await sleep(700)
  const undone = await layerHash()
  console.log('   undone', undone)
  if (undone !== originalHash) throw new Error('undo did not restore the original layer')

  console.log('[5] blur button only belongs to point/box config')
  await page.eval(() => window.__photoai.setTool('move'))
  await sleep(200)
  const inMove = await page.eval(() => !!document.querySelector('.blur-open-btn'))
  if (inMove) throw new Error('blur button leaked into the move config')

  console.log('[6] shortcuts work again after the dialog closes')
  await page.eval(() => window.__photoai.setTool('box'))
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 })
  await sleep(200)
  const shortcutTool = await page.eval(() => window.__photoai.tool)
  console.log('   ', shortcutTool)
  if (shortcutTool !== 'point') throw new Error('keyboard shortcuts stay blocked after the dialog')

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  if (errors.length) process.exitCode = 1
} catch (e) {
  console.error('FAILED:', e.message)
  console.error('page errors:', errors.length ? errors : 'none')
  await shot('blur-failure')
  process.exitCode = 1
} finally {
  await browser.close()
}
