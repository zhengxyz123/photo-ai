// SPDX-License-Identifier: Apache-2.0
// The wasm core runs here, off the main thread, so the canvas keeps painting
// during a 3.5 s encode or an 8 s inpaint.
//
// The browser owns the document (layers + mask). This worker holds only the
// flattened composite the models need: JS sends the composite after every edit,
// and every model call carries the mask it should use.
import type { CreatePhotoAI, PhotoAIModule } from './types/photo-ai'
import type { WorkerErrorCode, WorkerRequest, WorkerResponse } from './types/worker'

/// Failures carry a stable code so the editor can translate the message.
class WorkerFailure extends Error {
  readonly code: WorkerErrorCode
  readonly params?: Record<string, number>

  constructor(code: WorkerErrorCode, params?: Record<string, number>) {
    super(code)
    this.code = code
    this.params = params
  }
}

// Runtime models. `bytes` is the uncompressed file size: it drives the
// download progress total even when the server omits Content-Length (chunked or
// compressed responses, e.g. `npm run preview`).
const MODELS = {
  sam: [
    { url: '/models/sam_encoder.mnn', bytes: 27969944 },
    { url: '/models/sam_decoder.mnn', bytes: 24887840 },
  ],
  lama: [{ url: '/models/lama.mnn', bytes: 206349904 }],
} as const

const ctx = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null
}

let M: PhotoAIModule | null = null
let initPromise: Promise<PhotoAIModule> | null = null
let samPromise: Promise<void> | null = null
let lamaPromise: Promise<void> | null = null

const post = (msg: WorkerResponse, transfer?: Transferable[]) => {
  ctx.postMessage(msg, transfer ?? [])
}

async function boot(): Promise<PhotoAIModule> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    // The Emscripten glue lives in public/ and is served as-is. Importing it
    // from / directly would make Vite try to transform a public file, so load
    // the bytes and evaluate them as a blob module; locateFile keeps the wasm
    // next to the served page instead of the blob URL.
    const res = await fetch('/photo_ai.js')
    if (!res.ok) throw new Error(`photo_ai.js → HTTP ${res.status}`)
    const source = await res.text()
    const glueUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    try {
      const glue = (await import(/* @vite-ignore */ glueUrl)) as { default: CreatePhotoAI }
      const module = await glue.default({
        locateFile: (path) => `/${path}`,
      })
      M = module
      post({ type: 'wasm-ready' })
      return module
    } finally {
      URL.revokeObjectURL(glueUrl)
    }
  })().catch((err) => {
    // Do not poison every later request if the glue/wasm failed to start.
    initPromise = null
    throw err
  })
  return initPromise
}

/**
 * Stream a model file straight into the wasm heap. MNN copies the bytes during
 * createFromBuffer, so the buffer is freed as soon as the model is parsed.
 *
 * `expectedBytes` is the uncompressed model size from MODELS. It is the only
 * reliable total when the server compresses the file: `npm run preview` gzips
 * .mnn responses, which removes Content-Length (chunked) or makes it describe
 * the compressed body. Using the known size also lets us allocate once and
 * stream, instead of buffering hundreds of megabytes of chunks in JS.
 */
async function fetchIntoHeap(
  url: string,
  expectedBytes: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ ptr: number; len: number }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  const encoded = !!res.headers.get('Content-Encoding')
  const headerBytes = encoded ? 0 : Number(res.headers.get('Content-Length')) || 0
  const total = expectedBytes > 0 ? expectedBytes : headerBytes
  const m = await boot()
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    const ptr = m._malloc(buf.length)
    if (!ptr) throw new Error(`${url}: cannot allocate ${buf.length} bytes`)
    m.HEAPU8.set(buf, ptr)
    onProgress?.(buf.length, total || buf.length)
    return { ptr, len: buf.length }
  }
  const reader = res.body.getReader()
  // Stream into a single heap allocation. If the body outgrows the declared
  // size (a regenerated model), grow it rather than writing past the end.
  let capacity = total > 0 ? total : 8 * 1024 * 1024
  let ptr = m._malloc(capacity)
  if (!ptr) throw new Error(`${url}: cannot allocate ${capacity} bytes`)
  let off = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (off + value.length > capacity) {
        let next = capacity
        while (next < off + value.length) next *= 2
        const grown = m._malloc(next)
        if (!grown) throw new Error(`${url}: cannot allocate ${next} bytes`)
        // Re-read HEAPU8: a heap grow detaches the previous view.
        m.HEAPU8.copyWithin(grown, ptr, ptr + off)
        m._free(ptr)
        ptr = grown
        capacity = next
      }
      m.HEAPU8.set(value, ptr + off)
      off += value.length
      onProgress?.(off, total)
    }
  } catch (err) {
    m._free(ptr)
    throw err
  }
  if (off === 0) {
    m._free(ptr)
    throw new Error(`${url}: empty response`)
  }
  // `total` may be an approximate size from MODELS, so accept a short/long
  // body and let MNN validate it; only a zero-length download is fatal.
  return { ptr, len: off }
}

async function loadSam(): Promise<void> {
  const m = await boot()
  const t0 = performance.now()
  const parts: { ptr: number; len: number }[] = []
  let done = 0
  const bytes = MODELS.sam.reduce((a, model) => a + model.bytes, 0)
  try {
    for (const model of MODELS.sam) {
      const part = await fetchIntoHeap(model.url, model.bytes, (n) => {
        post({ type: 'model-progress', which: 'sam', loaded: done + n, total: bytes })
      })
      parts.push(part)
      done += part.len
    }
    const [encoder, decoder] = parts
    if (!encoder || !decoder) throw new WorkerFailure('sam-incomplete')
    const rc = m._pa_load_sam(encoder.ptr, encoder.len, decoder.ptr, decoder.len)
    if (rc !== 0) throw new WorkerFailure('sam-load-failed', { code: rc })
  } catch (err) {
    // A failed fetch/parse must release whatever was already downloaded.
    for (const part of parts) m._free(part.ptr)
    throw err
  }
  for (const part of parts) m._free(part.ptr)
  const ms = performance.now() - t0
  post({ type: 'sam-ready', ms, bytes: done })
}

/**
 * Load MobileSAM at most once. A failed attempt is forgotten so the next
 * composite/segment request can retry instead of leaving the model permanently
 * unavailable until the page reloads.
 */
function ensureSam(): Promise<void> {
  if (!samPromise) {
    samPromise = loadSam().catch((err) => {
      samPromise = null
      throw err
    })
  }
  return samPromise
}

async function loadLama(): Promise<void> {
  if (lamaPromise) return lamaPromise
  lamaPromise = (async () => {
    const m = await boot()
    const t0 = performance.now()
    post({ type: 'model-start', which: 'lama' })
    const model = MODELS.lama[0]
    if (!model) throw new WorkerFailure('lama-config-missing')
    const part = await fetchIntoHeap(model.url, model.bytes, (n, total) => {
      post({ type: 'model-progress', which: 'lama', loaded: n, total })
    })
    const rc = m._pa_load_lama(part.ptr, part.len)
    m._free(part.ptr)
    if (rc !== 0) throw new WorkerFailure('lama-load-failed', { code: rc })
    const ms = performance.now() - t0
    post({ type: 'lama-ready', ms, bytes: part.len })
  })().catch((err) => {
    // A failed download/parse must not poison the next fill attempt.
    lamaPromise = null
    throw err
  })
  return lamaPromise
}

// Copy a mask into the heap, run, free. Returns the C++ return code.
function withMask(mask: Uint8Array, fn: () => number): number {
  const m = M
  if (!m) throw new WorkerFailure('wasm-not-ready')
  const ptr = m._malloc(mask.length)
  m.HEAPU8.set(mask, ptr)
  const rc = m._pa_set_mask(ptr)
  m._free(ptr)
  if (rc !== 0) return rc
  return fn()
}

// ------------------------------------------------------------------ messages
const queue: Array<() => Promise<void>> = []
let running = false

function enqueue(job: () => Promise<void>): void {
  queue.push(job)
  if (!running) void runNext()
}

async function runNext(): Promise<void> {
  running = true
  while (queue.length) {
    const job = queue.shift()
    if (!job) continue
    try {
      await job()
    } catch (err) {
      if (err instanceof WorkerFailure) {
        post({ type: 'error', code: err.code, params: err.params })
      } else {
        post({
          type: 'error',
          code: 'unknown',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  running = false
}

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  switch (msg.type) {
    case 'init':
      enqueue(async () => {
        await ensureSam()
        post({ type: 'ready' })
      })
      break

    // The flattened document, sent after every edit.
    case 'composite': {
      const { width, height, rgb, reason } = msg
      enqueue(async () => {
        const m = await boot()
        // Retry MobileSAM here if the initial load failed.
        await ensureSam()
        const ptr = m._malloc(rgb.length)
        m.HEAPU8.set(rgb, ptr)
        const rc = m._pa_set_image(ptr, width, height)
        m._free(ptr)
        if (rc !== 0) throw new WorkerFailure('composite-failed', { code: rc })
        const t0 = performance.now()
        const erc = m._pa_encode()
        if (erc !== 0) throw new WorkerFailure('encode-failed', { code: erc })
        post({ type: 'encoded', ms: performance.now() - t0, width, height, reason })
      })
      break
    }

    case 'segment': {
      const { points, box } = msg
      enqueue(async () => {
        // Also covers a prompt retried after the SAM download failed.
        await ensureSam()
        const m = M
        if (!m) throw new WorkerFailure('wasm-not-ready')
        const n = points.length
        const positives = points.filter((p) => p.label === 1)
        const npos = positives.length
        const nneg = n - npos
        // Positive points first, then negatives, so C++ can split by count.
        const ordered = [...positives, ...points.filter((p) => p.label === 0)]
        let ptsPtr = 0
        let boxPtr = 0
        if (n > 0) {
          ptsPtr = m._malloc(n * 2 * 4)
          const view = new Float32Array(m.HEAPF32.buffer, ptsPtr, n * 2)
          ordered.forEach((p, i) => {
            view[i * 2] = p.x
            view[i * 2 + 1] = p.y
          })
        }
        if (box) {
          boxPtr = m._malloc(4 * 4)
          const view = new Float32Array(m.HEAPF32.buffer, boxPtr, 4)
          view[0] = box.x0
          view[1] = box.y0
          view[2] = box.x1
          view[3] = box.y1
        }
        const t0 = performance.now()
        const rc = m._pa_segment(ptsPtr, npos, nneg, boxPtr, box ? 1 : 0, -1)
        const ms = performance.now() - t0
        if (ptsPtr) m._free(ptsPtr)
        if (boxPtr) m._free(boxPtr)
        if (rc !== 0) throw new WorkerFailure('segment-failed', { code: rc })

        const w = m._pa_width()
        const h = m._pa_height()
        const area = m._pa_mask_area()
        const iou = [0, 1, 2, 3].map((i) => m._pa_iou(i))
        const best = m._pa_best_token()
        const maskPtr = m._pa_mask_ptr()
        const mask = new Uint8Array(w * h)
        mask.set(m.HEAPU8.subarray(maskPtr, maskPtr + w * h))
        post({ type: 'mask', mask: mask.buffer, area, iou, best, ms }, [mask.buffer])
      })
      break
    }

    // Which fill path would this mask take? The editor uses the answer to
    // describe the upcoming fill (local patch vs. full image) before it runs.
    case 'region': {
      const { dilate, mask } = msg
      enqueue(async () => {
        await boot()
        const rc = withMask(new Uint8Array(mask), () => {
          const m = M
          if (!m) throw new WorkerFailure('wasm-not-ready')
          const ptr = m._malloc(4 * 4)
          const code = m._pa_fill_region(dilate, ptr)
          if (code === 0) {
            const out = new Int32Array(new Int32Array(m.HEAP32.buffer, ptr, 4))
            post({
              type: 'region',
              local: out[0] === 0,
              size: out[1] ?? null,
              region: out[2] ?? null,
            })
          }
          m._free(ptr)
          return code
        })
        if (rc !== 0) post({ type: 'region', local: null, size: null, region: null })
      })
      break
    }

    case 'fill': {
      const { dilate, feather, mask } = msg
      enqueue(async () => {
        await loadLama()
        const m = M
        if (!m) throw new WorkerFailure('wasm-not-ready')
        const t0 = performance.now()
        const rc = withMask(new Uint8Array(mask), () => m._pa_fill(dilate, feather, 0))
        const ms = performance.now() - t0
        if (rc !== 0) {
          throw rc === -3
            ? new WorkerFailure('empty-selection')
            : new WorkerFailure('fill-failed', { code: rc })
        }
        const w = m._pa_width()
        const h = m._pa_height()
        const ptr = m._pa_result_ptr()
        const rgb = new Uint8Array(w * h * 3)
        rgb.set(m.HEAPU8.subarray(ptr, ptr + w * h * 3))
        const aPtr = m._pa_used_alpha_ptr()
        const alpha = new Uint8Array(w * h)
        alpha.set(m.HEAPU8.subarray(aPtr, aPtr + w * h))
        post({ type: 'filled', rgb: rgb.buffer, alpha: alpha.buffer, width: w, height: h, ms }, [
          rgb.buffer,
          alpha.buffer,
        ])
      })
      break
    }

    default:
      break
  }
}
