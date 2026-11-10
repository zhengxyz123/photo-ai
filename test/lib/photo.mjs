// Test fixture loader: the sample photo is a test-only asset and is not part
// of the built app. Read it in Node and hand the bytes to the page.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PHOTO = fileURLToPath(new URL('../data/example.jpg', import.meta.url))
const PHOTO_B64 = readFileSync(PHOTO).toString('base64')

export async function dropPhoto(page, name = 'example.jpg') {
  return page.eval(
    async ({ b64, name }) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const file = new File([bytes], name, { type: 'image/jpeg' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const stage = document.querySelector('.stage-panel')
      for (const type of ['dragenter', 'dragover', 'drop']) {
        stage.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
      }
      return { bytes: bytes.length }
    },
    { b64: PHOTO_B64, name },
  )
}
