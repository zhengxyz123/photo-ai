import { Browser, sleep } from './lib/cdp.mjs'
import { mkdirSync } from 'node:fs'

const url = process.argv[2] || 'http://127.0.0.1:8177/'
const out = 'test/artifacts'
mkdirSync(out, { recursive: true })

const browser = await Browser.launch({ width: 1440, height: 900 })
const page = await browser.newPage({ width: 1440, height: 900 })
const errors = []

page.browser.on(page.sessionId, 'Runtime.consoleAPICalled', (p) => {
  const text = p.args?.map((a) => a.value ?? a.description ?? '').join(' ')
  console.log('  [console]', p.type, text)
  if (p.type === 'error') errors.push(text)
})
page.browser.on(page.sessionId, 'Runtime.exceptionThrown', (p) => {
  const d = p.exceptionDetails
  const text = d?.exception?.description || d?.text || 'exception'
  console.log('  [exception]', text.slice(0, 500))
  errors.push(text)
})

try {
  await page.goto(url, { settleMs: 1500 })
  await sleep(1500)
  const info = await page.eval(() => ({
    title: document.title,
    h1: [...document.querySelectorAll('h1')].map((n) => n.textContent.trim()),
    status: document.querySelector('.status-pill')?.textContent.trim(),
    model: [...document.querySelectorAll('.model-row')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
    layers: document.querySelectorAll('.layer-row').length,
    canvas: (() => {
      const c = document.querySelector('.stage-canvas')
      const r = c?.getBoundingClientRect()
      return c ? { w: c.width, h: c.height, cw: r.width, ch: r.height } : null
    })(),
    stage: (() => {
      const r = document.querySelector('.stage-panel')?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
    })(),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    fonts: getComputedStyle(document.body).fontFamily,
  }))
  console.log(JSON.stringify(info, null, 2))
  await page.screenshot({ path: `${out}/vue-empty-1440.png`, format: 'png' })
  console.log('errors:', errors.length ? errors : 'none')
} finally {
  await browser.close()
}
