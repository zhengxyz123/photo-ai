// Image menu: frame operations, the size dialog, and menu auto-close.
//   node test/image.mjs [url]
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

async function waitFor(desc, fn, timeout = 90000, arg) {
  const t0 = Date.now()
  for (;;) {
    let v
    try { v = await page.eval(fn, arg) } catch { v = null }
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
async function move(x, y) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) })
}
async function drag(x0, y0, x1, y1, steps = 12) {
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
async function menuRect(label) {
  return page.eval((label) => {
    const el = [...document.querySelectorAll('.menu-btn')].find((b) => b.textContent.trim() === label)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, label)
}
async function openMenu(label) {
  const r = await menuRect(label)
  if (!r) throw new Error('no menu button ' + label)
  await click(r.x, r.y)
  await waitFor(`${label} menu`, (label) => {
    const menus = [...document.querySelectorAll('.n-dropdown-menu')].filter((m) => {
      const r = m.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    const text = menus.map((m) => m.textContent).join(' ')
    return text.includes(label === '图像' ? '画布大小' : '打开图片')
  }, 5000, label)
  await sleep(250)
}
async function visibleMenuText() {
  return page.eval(() => {
    const menus = [...document.querySelectorAll('.n-dropdown-menu')].filter((m) => {
      const r = m.getBoundingClientRect()
      const s = getComputedStyle(m)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    })
    const menu = menus[menus.length - 1]
    return menu ? [...menu.querySelectorAll('.menu-option-label')].map((n) => n.textContent) : []
  })
}
async function choose(label) {
  const r = await page.eval((label) => {
    const menus = [...document.querySelectorAll('.n-dropdown-menu')].filter((m) => {
      const r = m.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    const menu = menus[menus.length - 1]
    const el = menu ? [...menu.querySelectorAll('.n-dropdown-option')]
      .find((n) => n.textContent.includes(label)) : null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, label)
  if (!r) throw new Error('no menu option ' + label)
  await click(r.x, r.y)
  await sleep(250)
}
async function waitReady() {
  await waitFor('ready', () => document.querySelector('.status-pill')?.textContent.trim() === '就绪', 90000)
}
async function setField(index, value) {
  await page.eval(({ index, value }) => {
    const input = document.querySelectorAll('.size-dialog input')[index]
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    input.focus()
    setter.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.blur()
  }, { index, value })
  await sleep(100)
}
async function applyDialog() {
  await page.eval(() => {
    [...document.querySelectorAll('.size-actions .n-button')]
      .find((b) => b.textContent.includes('应用'))?.click()
  })
  await sleep(200)
}
async function dims() {
  return page.eval(() => window.__photoai.doc)
}

try {
  await page.goto(URL, { settleMs: 800 })
  await waitFor('boot', () => !!window.__photoai)
  await dropPhoto(page)
  await waitReady()
  const original = await dims()
  console.log('[1] image menu')
  await openMenu('图像')
  const items = await visibleMenuText()
  console.log('   ', JSON.stringify(items))
  const wanted = ['画布大小', '画布适配图层', '缩放图像', '裁剪到选区', '裁剪到内容']
  if (JSON.stringify(items) !== JSON.stringify(wanted)) throw new Error('image menu mismatch')
  await shot('image-menu')

  console.log('[2] leaving the menu bar closes every menu')
  const item = await page.eval(() => {
    const el = [...document.querySelectorAll('.n-dropdown-option')]
      .find((n) => n.textContent.includes('画布大小'))
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await move(item.x, item.y)
  await sleep(300)
  if (!(await page.eval(() => window.__photoai.menuOpen))) {
    throw new Error('menu closed while the pointer was inside the dropdown')
  }
  const stage = await imagePoint(original.w / 2, original.h / 2)
  await move(stage.x, stage.y)
  await sleep(350)
  const closed = await page.eval(() => {
    const visible = [...document.querySelectorAll('.n-dropdown-menu')].some((m) => {
      const r = m.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(m).visibility !== 'hidden'
    })
    return { flag: window.__photoai.menuOpen, visible }
  })
  console.log('   ', JSON.stringify(closed))
  if (closed.flag || closed.visible) throw new Error('menu stayed open after leaving the bar')

  console.log('[3] canvas size dialog')
  await openMenu('图像')
  await choose('画布大小')
  await waitFor('size dialog', () => !!document.querySelector('.size-dialog'))
  await shot('image-canvas-dialog')
  await setField(0, original.w - 80)
  await setField(1, original.h - 60)
  await applyDialog()
  await waitReady()
  const resized = await dims()
  console.log('   ', JSON.stringify(resized))
  if (resized.w !== original.w - 80 || resized.h !== original.h - 60) throw new Error('canvas resize failed')
  await shot('image-canvas-resized')
  await page.eval(() => window.__photoai.undo())
  await waitReady()
  const undone = await dims()
  if (undone.w !== original.w || undone.h !== original.h) throw new Error('canvas size undo failed')
  console.log('   undo', JSON.stringify(undone))

  console.log('[4] scale image with locked ratio')
  await openMenu('图像')
  await choose('缩放图像')
  await waitFor('scale dialog', () => !!document.querySelector('.size-dialog'))
  await setField(0, Math.round(original.w / 2))
  const locked = await page.eval(() => {
    const inputs = [...document.querySelectorAll('.size-dialog input')]
    return inputs.map((i) => Number(i.value))
  })
  console.log('   locked fields', JSON.stringify(locked))
  if (locked[1] !== Math.round(original.h / 2)) throw new Error('aspect lock failed')
  await shot('image-scale-dialog')
  await applyDialog()
  await waitReady()
  const scaled = await dims()
  console.log('   ', JSON.stringify(scaled))
  if (scaled.w !== Math.round(original.w / 2) || scaled.h !== Math.round(original.h / 2)) {
    throw new Error('scale failed')
  }
  await page.eval(() => window.__photoai.undo())
  await waitReady()

  console.log('[5] crop to selection')
  await page.eval(() => window.__photoai.setTool('box'))
  const a = await imagePoint(120, 180)
  const b = await imagePoint(420, 460)
  await drag(a.x, a.y, b.x, b.y, 14)
  await waitFor('mask', () => !!window.__photoai.mask && !window.__photoai.busy, 60000)
  const bbox = await page.eval(() => {
    const m = window.__photoai.mask
    const d = window.__photoai.doc
    let x0 = d.w, y0 = d.h, x1 = -1, y1 = -1
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        if (!m[y * d.w + x]) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1 }
  })
  await openMenu('图像')
  await choose('裁剪到选区')
  await waitReady()
  const cropped = await dims()
  console.log('   bbox', JSON.stringify(bbox), 'crop', JSON.stringify(cropped))
  if (cropped.w !== bbox.w || cropped.h !== bbox.h) throw new Error('crop to selection failed')
  if (await page.eval(() => !!window.__photoai.mask)) throw new Error('selection survived crop')
  await page.eval(() => window.__photoai.undo())
  await waitReady()

  console.log('[6] fit the canvas to the active layer')
  await page.eval(() => window.__photoai.clearSelection())
  await page.eval(() => window.__photoai.setTool('box'))
  const c = await imagePoint(180, 140)
  const d = await imagePoint(360, 400)
  await drag(c.x, c.y, d.x, d.y, 14)
  await waitFor('mask for cut', () => !!window.__photoai.mask && !window.__photoai.busy, 60000)
  await page.eval(() => {
    [...document.querySelectorAll('.action-grid .n-button')]
      .find((b) => b.textContent.includes('剪切为图层'))?.click()
  })
  await sleep(900)
  const cut = await page.eval(() => {
    const d = window.__photoai.doc
    const layer = window.__photoai.layers.find((l) => l.name.startsWith('剪切'))
    return { doc: d, bbox: layer?.bbox, offset: layer?.offset }
  })
  console.log('   cut layer', JSON.stringify(cut))
  await openMenu('图像')
  await choose('画布适配图层')
  await waitReady()
  const fitted = await dims()
  console.log('   fitted', JSON.stringify(fitted))
  if (fitted.w !== cut.bbox.w || fitted.h !== cut.bbox.h) throw new Error('fit canvas to layer failed')
  await page.eval(() => window.__photoai.undo())
  await waitReady()

  console.log('[7] enlarge canvas, then crop to content')
  await openMenu('图像')
  await choose('画布大小')
  await waitFor('size dialog', () => !!document.querySelector('.size-dialog'))
  await setField(0, original.w + 120)
  await setField(1, original.h + 100)
  await applyDialog()
  await waitReady()
  const enlarged = await dims()
  console.log('   enlarged', JSON.stringify(enlarged))
  await openMenu('图像')
  await choose('裁剪到内容')
  await waitReady()
  const trimmed = await dims()
  console.log('   trimmed', JSON.stringify(trimmed))
  if (trimmed.w !== original.w || trimmed.h !== original.h) throw new Error('crop to content failed')
  await shot('image-cropped-content')

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  if (errors.length) process.exitCode = 1
} catch (e) {
  console.error('FAILED:', e.message)
  console.error('page errors:', errors.length ? errors : 'none')
  await shot('image-failure')
  process.exitCode = 1
} finally {
  await browser.close()
}
