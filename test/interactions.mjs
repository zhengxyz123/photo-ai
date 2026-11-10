// Focused interaction pass: menus, box select, add/subtract, move, row menu.
//   node test/interactions.mjs [url]
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
async function click(x, y, { button = 'left', modifiers = 0, clickCount = 1 } = {}) {
  const base = { x: Math.round(x), y: Math.round(y), button, clickCount, modifiers }
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
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
async function area() {
  return page.eval(() => {
    const m = window.__photoai.mask
    if (!m) return 0
    let n = 0
    for (let i = 0; i < m.length; i++) if (m[i]) n++
    return n
  })
}
async function setMode(label) {
  await page.eval((label) => {
    [...document.querySelectorAll('.mode-btn')].find((b) => b.textContent.trim() === label)?.click()
  }, label)
  await sleep(100)
}
async function tool(label) {
  await page.eval((label) => {
    [...document.querySelectorAll('.tool-row')].find((b) => b.textContent.includes(label))?.click()
  }, label)
  await sleep(100)
}
async function menuRect(label) {
  return page.eval((label) => {
    const el = [...document.querySelectorAll('.menu-btn')].find((b) => b.textContent.trim() === label)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, label)
}
async function hoverMenu(label) {
  const r = await menuRect(label)
  if (!r) throw new Error('no menu button ' + label)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(r.x), y: Math.round(r.y) })
  await sleep(400)
}
async function closeMenus() {
  await click(700, 20)
  await sleep(300)
  await waitFor('menus closed', () => !window.__photoai.menuOpen, 5000)
  await waitFor('idle after menus', () => !window.__photoai.busy, 60000)
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


try {
  await page.goto(URL, { settleMs: 800 })
  await waitFor('boot', () => !!window.__photoai)
  await dropPhoto(page)
  await waitFor('ready', () => document.querySelector('.status-pill')?.textContent.trim() === '就绪', 90000)

  console.log('[1] menu bar: hover switches only after a menu is open')
  await hoverMenu('编辑')
  const idleMenus = await visibleMenuText()
  console.log('   hover while idle', JSON.stringify(idleMenus))
  if (idleMenus.length) throw new Error('hover opened a menu while the bar was idle')
  await hoverMenu('文件')
  const fileBtn = await menuRect('文件')
  await click(fileBtn.x, fileBtn.y)
  await waitFor('file dropdown', () => {
  const menus = [...document.querySelectorAll('.n-dropdown-menu')].filter((m) => {
    const r = m.getBoundingClientRect()
    const s = getComputedStyle(m)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  })
  return menus.some((m) => m.textContent.includes('打开图片'))
})
  const fileMenu = await visibleMenuText()
  console.log('   ', JSON.stringify(fileMenu))
  await shot('menu-file')

  await hoverMenu('编辑')
  await waitFor('hover edit menu', () => {
    const menus = [...document.querySelectorAll('.n-dropdown-menu')].filter((m) => {
      const r = m.getBoundingClientRect()
      const s = getComputedStyle(m)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    })
    return menus.some((m) => m.textContent.includes('撤销'))
  })
  console.log('   hover -> edit', JSON.stringify(await visibleMenuText()))
  await shot('menu-hover-edit')

  await hoverMenu('图层')
  await waitFor('hover layer menu', () => {
    const menus = [...document.querySelectorAll('.n-dropdown-menu')].filter((m) => {
      const r = m.getBoundingClientRect()
      const s = getComputedStyle(m)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    })
    return menus.some((m) => m.textContent.includes('重命名图层'))
  })
  console.log('   hover -> layer', JSON.stringify(await visibleMenuText()))
  await shot('menu-hover-layer')
  await closeMenus()

  console.log('[2] layer menu')
  await page.eval(() => [...document.querySelectorAll('.menu-btn')].find((b) => b.textContent.trim() === '图层')?.click())
  await waitFor('layer dropdown', () => {
  const menus = [...document.querySelectorAll('.n-dropdown-menu')].filter((m) => {
    const r = m.getBoundingClientRect()
    const s = getComputedStyle(m)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  })
  return menus.some((m) => m.textContent.includes('重命名图层'))
})
  console.log('   ', JSON.stringify(await visibleMenuText()))
  await shot('menu-layer')
  await closeMenus()

  console.log('[3] box select around the sword hilt')
  await tool('框选')
  const a = await imagePoint(70, 130)
  const b = await imagePoint(260, 420)
  await drag(a.x, a.y, b.x, b.y, 14)
  await waitFor('box mask', () => !!window.__photoai.mask && !window.__photoai.busy, 60000)
  console.log('   area', await area())
  await shot('interaction-box')

  console.log('[4] add mode, click the pommel')
  await tool('点选')
  await setMode('加选')
  const c = await imagePoint(175, 155)
  await click(c.x, c.y)
  await waitFor('add done', () => !window.__photoai.busy, 60000)
  console.log('   area', await area())
  await shot('interaction-add')

  console.log('[5] subtract mode, click the same point')
  await setMode('减选')
  await click(c.x, c.y)
  await waitFor('subtract done', () => !window.__photoai.busy, 60000)
  console.log('   area', await area())
  await shot('interaction-subtract')

  console.log('[6] cut and move the new layer')
  await setMode('新建')
  await page.eval(() => window.__photoai.clearSelection())
  await tool('点选')
  await click(c.x, c.y)
  await waitFor('mask for cut', () => !!window.__photoai.mask && !window.__photoai.busy, 60000)
  await page.eval(() => {
    [...document.querySelectorAll('.action-grid .n-button')].find((b) => b.textContent.includes('剪切为图层'))?.click()
  })
  await sleep(800)
  const before = await page.eval(() => window.__photoai.layers.map((l) => ({ name: l.name, offset: l.offset })))
  console.log('   before', JSON.stringify(before))
  const from = await imagePoint(175, 155)
  const to = await imagePoint(285, 220)
  await drag(from.x, from.y, to.x, to.y, 16)
  await sleep(900)
  const after = await page.eval(() => window.__photoai.layers.map((l) => ({ name: l.name, offset: l.offset })))
  console.log('   after ', JSON.stringify(after))
  await shot('interaction-move')

  console.log('[7] row menu (visual check)')
  await page.eval(() => {
    const row = document.querySelector('.layer-row.active .layer-more')
    row?.click()
  })
  await waitFor('row menu', () => {
    const menus = [...document.querySelectorAll('.n-dropdown-menu')].filter((m) => {
      const r = m.getBoundingClientRect()
      const s = getComputedStyle(m)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    })
    return menus.some((m) => m.textContent.includes('向下合并'))
  })
  console.log('   visible menus', JSON.stringify(await page.eval(() => [...document.querySelectorAll('.n-dropdown-menu')].filter((m) => m.getBoundingClientRect().height > 0).map((m) => m.textContent.replace(/\s+/g, ' ').trim()))))
  await shot('menu-row')

  console.log('[8] delete from the open row menu, then undo')
  const opt = await page.eval(() => {
    const menus = [...document.querySelectorAll('.n-dropdown-menu')].filter((m) => {
      const r = m.getBoundingClientRect()
      const s = getComputedStyle(m)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    })
    const menu = menus[menus.length - 1]
    const n = menu ? [...menu.querySelectorAll('.n-dropdown-option')].find((x) => x.textContent.includes('删除图层')) : null
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  console.log('   delete option at', JSON.stringify(opt))
  if (!opt) throw new Error('no delete option')
  await click(opt.x, opt.y)
  await waitFor('layer deleted', () => window.__photoai.layers.length === 1, 5000)
  console.log('   layers after delete', JSON.stringify(await page.eval(() => window.__photoai.layers.map((l) => l.name))))
  await page.eval(() => window.__photoai.undo())
  await waitFor('delete undone', () => window.__photoai.layers.length === 2, 5000)
  console.log('   layers after undo', JSON.stringify(await page.eval(() => window.__photoai.layers.map((l) => l.name))))
  await shot('interaction-deleted-undo')

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  if (errors.length) process.exitCode = 1
} catch (e) {
  console.error('FAILED:', e.message)
  console.error('page errors:', errors.length ? errors : 'none')
  await shot('interaction-failure')
  process.exitCode = 1
} finally {
  await browser.close()
}
