// Layout probe at a given viewport: does anything overflow the shell?
//   node test/viewport.mjs 1366 768 [url]
import { mkdirSync } from 'node:fs'
import { Browser } from './lib/cdp.mjs'

const w = Number(process.argv[2] || 1280)
const h = Number(process.argv[3] || 720)
const url = process.argv[4] || 'http://127.0.0.1:8177/'
mkdirSync('test/artifacts', { recursive: true })

const b = await Browser.launch({ width: w, height: h })
const p = await b.newPage({ width: w, height: h })
await p.goto(url, { settleMs: 3000 })
const m = await p.eval(() => {
  const out = {}
  for (const [k, sel] of Object.entries({
    work: '.shell',
    left: '.rail-left',
    right: '.rail-right',
    stage: '.stage-panel',
    selPanel: '.tool-config',
    model: '.model-block',
    layers: '.layer-panel',
  })) {
    const e = document.querySelector(sel)
    if (!e) continue
    const r = e.getBoundingClientRect()
    out[k] = {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      h: Math.round(r.height),
      scrollH: e.scrollHeight,
      overflow: Math.round(e.scrollHeight - e.clientHeight),
    }
  }
  out.doc = {
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
  }
  return out
})
console.log(`${w}x${h}`, JSON.stringify(m, null, 1))
await p.screenshot({ path: `test/artifacts/viewport-${w}x${h}.png`, format: 'png' })
await b.close()
