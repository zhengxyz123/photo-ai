// SPDX-License-Identifier: Apache-2.0
import { onBeforeUnmount, reactive } from 'vue'

/**
 * Pointer-based dragging for the tool dialogs.
 *
 * The dialogs used Naive UI's built-in `draggable`, which only listens to
 * mouse events. Pointer events cover mouse, touch and pen, and keeping our own
 * state lets us clamp the dialog to the viewport and reset it when it reopens.
 */
export function useDialogDrag() {
  const offset = reactive({ x: 0, y: 0 })
  let state: {
    pointerId: number
    startX: number
    startY: number
    baseX: number
    baseY: number
    rect: DOMRect
  } | null = null

  function onPointerDown(event: PointerEvent): void {
    if (state) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const target = event.target as Element | null
    if (!target?.closest('.n-card-header')) return
    const card = event.currentTarget as HTMLElement | null
    if (!card) return

    state = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
      rect: card.getBoundingClientRect(),
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    // Keep a drag on the title bar from selecting its text.
    event.preventDefault()
  }

  function onPointerMove(event: PointerEvent): void {
    if (!state || event.pointerId !== state.pointerId) return
    const margin = 8
    let dx = event.clientX - state.startX
    let dy = event.clientY - state.startY

    // Keep the whole card visible so it can always be grabbed again.
    const minX = margin - state.rect.left
    const maxX = window.innerWidth - margin - state.rect.right
    const minY = margin - state.rect.top
    const maxY = window.innerHeight - margin - state.rect.bottom
    if (minX <= maxX) dx = Math.min(maxX, Math.max(minX, dx))
    if (minY <= maxY) dy = Math.min(maxY, Math.max(minY, dy))

    offset.x = state.baseX + dx
    offset.y = state.baseY + dy
  }

  function endDrag(): void {
    if (!state) return
    state = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  }

  function onPointerUp(event: PointerEvent): void {
    if (!state || event.pointerId !== state.pointerId) return
    endDrag()
  }

  function reset(): void {
    endDrag()
    offset.x = 0
    offset.y = 0
  }

  onBeforeUnmount(endDrag)

  return { offset, reset, endDrag, onPointerDown }
}
