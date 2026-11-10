// End-to-end drive of the Vue editor:
// empty state → drop a photo → select → invert → cut → rename → merge → undo
// → reorder with SortableJS → add a layer → fill with LaMa → console check.
//
//   node test/drive.mjs [url]
//
// Uses the taste-skill's zero-dependency CDP client (Node 22+).
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
  const text = p.args?.map((a) => a.value ?? a.description ?? '').join(' ')
  if (p.type === 'error') {
    errors.push(text)
    console.log('  [console error]', text)
  }
})
page.browser.on(page.sessionId, 'Runtime.exceptionThrown', (p) => {
  const d = p.exceptionDetails
  const text = d?.exception?.description || d?.text || 'exception'
  errors.push(text)
  console.log('  [exception]', text.slice(0, 500))
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

async function click(x, y, { button = 'left', modifiers = 0, clickCount = 1 } = {}) {
  const base = { x: Math.round(x), y: Math.round(y), button, clickCount, modifiers }
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
}

async function drag(x0, y0, x1, y1, steps = 12) {
  const base = { button: 'left', clickCount: 1 }
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, ...base })
  await sleep(80)
  for (let i = 1; i <= steps; i++) {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x0 + ((x1 - x0) * i) / steps),
      y: Math.round(y0 + ((y1 - y0) * i) / steps),
      button: 'left',
    })
    await sleep(25)
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

async function state() {
  return page.eval(() => ({
    status: document.querySelector('.status-pill')?.textContent.trim(),
    doc: window.__photoai.doc,
    layers: window.__photoai.layers.map((l) => ({ name: l.name, offset: l.offset })),
    active: window.__photoai.activeId,
    mask: !!window.__photoai.mask,
    region: window.__photoai.region,
    busy: window.__photoai.busy,
    encoded: window.__photoai.encoded,
    tool: window.__photoai.tool,
  }))
}


async function setMode(label) {
  await page.eval((label) => {
    const b = [...document.querySelectorAll('.mode-btn')].find((x) => x.textContent.trim() === label)
    b?.click()
  }, label)
  await sleep(100)
}

try {
  console.log('[1] open', URL)
  await page.goto(URL, { settleMs: 800 })
  await waitFor('editor boot', () => !!window.__photoai)
  const initial = await page.eval(() => ({
    title: document.title,
    h1: [...document.querySelectorAll('h1')].map((n) => n.textContent.trim()),
    model: [...document.querySelectorAll('.model-row')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
    exampleRequests: performance.getEntriesByType('resource').filter((e) => e.name.includes('example.jpg')).length,
    forbiddenText: ['置信度', '像素', '提示点'].filter((t) => document.body.innerText.includes(t)),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  console.log('   ', JSON.stringify(initial))
  if (initial.exampleRequests) throw new Error('example.jpg was fetched on boot')
  if (initial.forbiddenText.length) throw new Error('implementation detail text visible: ' + initial.forbiddenText)
  await shot('vue-01-empty')

  console.log('[2] drop example.jpg')
  console.log('   ', JSON.stringify(await dropPhoto(page)))
  await waitFor('image prepared', () => document.querySelector('.status-pill')?.textContent.trim() === '就绪', 90000)
  console.log('   ', JSON.stringify(await state()))
  await shot('vue-02-loaded')

  console.log('[3] point-select the sword pommel at (175,155)')
  const p1 = await imagePoint(175, 155)
  await click(p1.x, p1.y)
  await waitFor('mask', () => !!window.__photoai.mask && !window.__photoai.busy, 60000)
  const selectionUI = await page.eval(() => ({
    specimen: document.querySelectorAll('.specimen').length,
    actions: [...document.querySelectorAll('.action-grid .n-button')].map((b) => b.textContent.trim()),
  }))
  console.log('   selection UI', JSON.stringify(selectionUI))
  if (selectionUI.specimen) throw new Error('selection preview box should be removed')
  for (const label of ['反转选区', '清除为透明', '剪切为图层', '取消选择']) {
    if (!selectionUI.actions.includes(label)) throw new Error(`missing selection action: ${label}`)
  }
  console.log('   ', JSON.stringify(await state()))
  await shot('vue-03-selected')

  console.log('[4] invert twice')
  await page.eval(() => document.querySelector('.action-grid .n-button')?.click())
  await sleep(400)
  const inverted = await state()
  await page.eval(() => document.querySelector('.action-grid .n-button')?.click())
  await sleep(400)
  console.log('   inverted mask', inverted.mask)
  await shot('vue-04-inverted')

  console.log('[5] cut the selection into a layer')
  await page.eval(() => {
    const buttons = [...document.querySelectorAll('.action-grid .n-button')]
    buttons.find((b) => b.textContent.includes('剪切为图层'))?.click()
  })
  await sleep(800)
  console.log('   ', JSON.stringify(await state()))
  await shot('vue-05-cut')

  console.log('[6] rename the active layer')
  await page.eval(() => {
    const buttons = [...document.querySelectorAll('.layer-actions .n-button')]
    buttons.find((b) => b.textContent.includes('重命名'))?.click()
  })
  await waitFor('rename input', () => !!document.querySelector('.rename-input input'))
  await page.eval(() => {
    const input = document.querySelector('.rename-input input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    input.focus()
    setter.call(input, '主体')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(400)
  console.log('   ', JSON.stringify((await state()).layers))
  await shot('vue-06-renamed')

  console.log('[7] merge down')
  await page.eval(() => {
    const buttons = [...document.querySelectorAll('.layer-actions .n-button')]
    buttons.find((b) => b.textContent.includes('向下合并'))?.click()
  })
  await sleep(800)
  console.log('   ', JSON.stringify((await state()).layers))
  await shot('vue-07-merged')

  console.log('[8] undo the merge')
  await page.eval(() => window.__photoai.undo())
  await sleep(800)
  console.log('   ', JSON.stringify((await state()).layers))
  await shot('vue-08-undo-merge')

  console.log('[9] reorder: drag the top layer below the background')
  const grips = await page.eval(() => [...document.querySelectorAll('.layer-row')].map((row) => {
    const g = row.querySelector('.layer-grip').getBoundingClientRect()
    const r = row.getBoundingClientRect()
    return { x: g.left + g.width / 2, y: g.top + g.height / 2, rowY: r.top + r.height / 2 }
  }))
  console.log('   grips', JSON.stringify(grips))
  if (grips.length >= 2) {
    await drag(grips[0].x, grips[0].y, grips[1].x, grips[1].rowY + 18, 16)
    await sleep(800)
  }
  console.log('   ', JSON.stringify((await state()).layers))
  await shot('vue-09-reordered')

  console.log('[10] add the same photo as a new layer')
  await dropPhoto(page)
  await waitFor('layer added', () => window.__photoai.layers.length >= 3, 60000)
  await waitFor('prepared again', () => !window.__photoai.busy, 60000)
  console.log('   ', JSON.stringify((await state()).layers))
  await shot('vue-10-added-layer')

  console.log('[11] fill the selection with LaMa')
  await page.eval(() => window.__photoai.clearSelection())
  await page.eval(() => window.__photoai.setTool('point'))
  const p2 = await imagePoint(175, 155)
  await click(p2.x, p2.y)
  await waitFor('mask for fill', () => !!window.__photoai.mask && !window.__photoai.busy, 60000)
  await page.eval(() => document.querySelector('.fill-btn')?.click())
  const fillLabel = await waitFor('fill phase label', () => {
    const t = document.querySelector('.busy-pill')?.textContent.trim()
    return t === '正在补全' ? t : null
  }, 240000)
  console.log('   busy label', fillLabel)
  await waitFor('fill done', () => !window.__photoai.mask && !window.__photoai.busy, 240000)
  console.log('   ', JSON.stringify(await state()))
  await shot('vue-11-filled')

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  if (errors.length) process.exitCode = 1
} catch (err) {
  console.error('FAILED:', err.message)
  await shot('vue-99-failure')
  process.exitCode = 1
} finally {
  await browser.close()
}
