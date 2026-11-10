<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDialog, useMessage } from 'naive-ui'
import MenuBar from './components/MenuBar.vue'
import ToolPanel from './components/ToolPanel.vue'
import ToolConfig from './components/ToolConfig.vue'
import StagePanel from './components/StagePanel.vue'
import LayerPanel from './components/LayerPanel.vue'
import ModelStatus from './components/ModelStatus.vue'
import StatusBar from './components/StatusBar.vue'
import { EditorKey } from './editor/context'
import { createEditor } from './editor/useEditor'

const editor = createEditor()
const message = useMessage()
const dialog = useDialog()
const { t } = useI18n()

editor.setErrorHandler((e) => {
  message.error(e.message, { duration: 6000 })
})

editor.requestOpenDocument = () => {
  if (!editor.hasDoc.value) {
    editor.pickImage('doc')
    return
  }
  dialog.warning({
    title: t('photo.openTitle'),
    content: t('photo.openBody'),
    positiveText: t('photo.open'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => editor.pickImage('doc'),
  })
}

provide(EditorKey, editor)

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    el.isContentEditable ||
    !!el.closest?.('.n-input, .n-slider, [contenteditable="true"]')
  )
}

function modalOpen(): boolean {
  return [...document.querySelectorAll('.n-modal-mask')].some((el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  })
}

function onKeydown(e: KeyboardEvent): void {
  if (isTyping(e.target)) return
  if (modalOpen()) return
  const mod = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()

  if (mod && key === 'z') {
    e.preventDefault()
    if (e.shiftKey) editor.redoEdit()
    else editor.undoEdit()
    return
  }
  if (mod && key === 'y') {
    e.preventDefault()
    editor.redoEdit()
    return
  }
  if (mod && key === 'o') {
    e.preventDefault()
    if (e.shiftKey) editor.pickImage(editor.hasDoc.value ? 'layer' : 'doc')
    else editor.requestOpenDocument()
    return
  }
  if (mod && key === 'e') {
    e.preventDefault()
    editor.exportPng()
    return
  }
  if (mod && (e.key === ']' || e.key === '[')) {
    e.preventDefault()
    editor.moveLayerBy(e.key === ']' ? 1 : -1)
    return
  }
  if (e.key === 'Escape') {
    if (editor.renamingId.value) {
      editor.renamingId.value = null
      return
    }
    editor.clearSelection()
    return
  }
  if (e.key === 'F2') {
    e.preventDefault()
    editor.startRename()
    return
  }
  if (mod) return
  if (key === 'p') {
    editor.setTool('point')
    return
  }
  if (key === 'b') {
    editor.setTool('box')
    return
  }
  if (key === 'v') {
    editor.setTool('move')
    return
  }
  if (e.key.startsWith('Arrow') && editor.hasDoc.value) {
    const step = e.shiftKey ? 10 : 1
    e.preventDefault()
    if (e.key === 'ArrowLeft') editor.nudgeActive(-step, 0)
    if (e.key === 'ArrowRight') editor.nudgeActive(step, 0)
    if (e.key === 'ArrowUp') editor.nudgeActive(0, -step)
    if (e.key === 'ArrowDown') editor.nudgeActive(0, step)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  editor.dispose()
})
</script>

<template>
  <div class="app">
    <MenuBar />
    <main class="shell">
      <aside class="rail rail-left" :aria-label="t('tools.heading')">
        <ToolPanel />
        <ToolConfig />
      </aside>
      <StagePanel />
      <aside class="rail rail-right" :aria-label="t('layers.heading')">
        <LayerPanel />
        <ModelStatus />
      </aside>
    </main>
    <StatusBar />
  </div>
</template>
