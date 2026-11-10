<script setup lang="ts">
import { computed, h, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { NButton, NDropdown, NTooltip } from 'naive-ui'
import AppIcon from './AppIcon.vue'
import ImageSizeDialog from './ImageSizeDialog.vue'
import { useEditorContext } from '../editor/context'

const editor = useEditorContext()
const {
  doc,
  hasDoc,
  busy,
  statusText,
  statusState,
  canUndo,
  canRedo,
  canExport,
  hasSelection,
  activeLayer,
  activeIndex,
  layers,
  canMergeDown,
  canDeleteLayer,
} = editor

const optionLabel = (text: string, shortcut?: string) => () =>
  h('div', { class: 'menu-option' }, [
    h('span', { class: 'menu-option-label' }, text),
    shortcut ? h('kbd', { class: 'menu-kbd' }, shortcut) : null,
  ])

const divider = { type: 'divider', key: 'divider' }

// A menu bar opens the next menu on hover when one is already open; it does
// not open anything when the bar is idle. `show` is controlled so all four
// dropdowns share one active key. Once a menu is open, moving the pointer out
// of the bar (or its dropdown) closes every menu.
const openMenu = ref<string | null>(null)
const navEl = ref<HTMLElement | null>(null)
let tracking = false

function setMenuShow(key: string, show: boolean): void {
  if (show) {
    openMenu.value = key
    editor.setMenuOpen(true)
  } else if (openMenu.value === key) {
    closeMenus()
  }
}

function onMenuHover(key: string): void {
  if (!openMenu.value || openMenu.value === key) return
  openMenu.value = key
  editor.setMenuOpen(true)
}

function closeMenus(): void {
  openMenu.value = null
  editor.setMenuOpen(false)
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  const s = getComputedStyle(el)
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
}

function within(rect: DOMRect, x: number, y: number, pad = 0): boolean {
  return (
    x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad
  )
}

function onMenuPointerMove(ev: PointerEvent): void {
  if (!openMenu.value) return
  if (navEl.value && within(navEl.value.getBoundingClientRect(), ev.clientX, ev.clientY, 6)) return
  const overPanel = [...document.querySelectorAll('.n-dropdown-menu')].some(
    (panel) =>
      isVisible(panel) && within(panel.getBoundingClientRect(), ev.clientX, ev.clientY, 14),
  )
  if (!overPanel) closeMenus()
}

function stopTracking(): void {
  if (!tracking) return
  tracking = false
  window.removeEventListener('pointermove', onMenuPointerMove)
}

function startTracking(): void {
  if (tracking) return
  tracking = true
  window.addEventListener('pointermove', onMenuPointerMove, { passive: true })
}

watch(openMenu, (v) => {
  if (v) startTracking()
  else stopTracking()
})

onBeforeUnmount(stopTracking)

const sizeDialog = reactive<{ show: boolean; mode: 'canvas' | 'scale' }>({
  show: false,
  mode: 'canvas',
})

function openSizeDialog(mode: 'canvas' | 'scale'): void {
  sizeDialog.mode = mode
  sizeDialog.show = true
}

function applySize({ w, h }: { w: number; h: number }): void {
  if (sizeDialog.mode === 'scale') editor.scaleImage(w, h)
  else editor.resizeCanvas(w, h)
}

const fileOptions = computed(() => [
  { key: 'open', label: optionLabel('打开图片…', 'Ctrl O') },
  { key: 'add', label: optionLabel('新增图层…', 'Ctrl Shift O'), disabled: !layers.value.length },
  divider,
  { key: 'export', label: optionLabel('导出 PNG', 'Ctrl E'), disabled: !canExport.value },
])

const editOptions = computed(() => [
  { key: 'undo', label: optionLabel('撤销', 'Ctrl Z'), disabled: !canUndo.value },
  { key: 'redo', label: optionLabel('重做', 'Ctrl Shift Z'), disabled: !canRedo.value },
  divider,
  { key: 'deselect', label: optionLabel('取消选择', 'Esc'), disabled: !hasSelection.value },
])

const imageOptions = computed(() => [
  {
    key: 'canvas-size',
    label: optionLabel('画布大小'),
    disabled: !hasDoc.value || busy.active,
  },
  {
    key: 'fit-layer',
    label: optionLabel('画布适配图层'),
    disabled: !hasDoc.value || !activeLayer.value || busy.active,
  },
  {
    key: 'scale',
    label: optionLabel('缩放图像'),
    disabled: !hasDoc.value || busy.active,
  },
  divider,
  {
    key: 'crop-selection',
    label: optionLabel('裁剪到选区'),
    disabled: !hasDoc.value || !hasSelection.value || busy.active,
  },
  {
    key: 'crop-content',
    label: optionLabel('裁剪到内容'),
    disabled: !hasDoc.value || busy.active,
  },
])

const layerOptions = computed(() => [
  { key: 'rename', label: optionLabel('重命名图层', 'F2'), disabled: !activeLayer.value },
  { key: 'merge', label: optionLabel('向下合并'), disabled: !canMergeDown.value },
  divider,
  {
    key: 'up',
    label: optionLabel('上移一层', 'Ctrl ]'),
    disabled: !activeLayer.value || activeIndex.value >= layers.value.length - 1,
  },
  {
    key: 'down',
    label: optionLabel('下移一层', 'Ctrl ['),
    disabled: !activeLayer.value || activeIndex.value <= 0,
  },
  divider,
  { key: 'delete', label: optionLabel('删除图层'), disabled: !canDeleteLayer.value },
])

function onFile(key: string): void {
  closeMenus()
  if (key === 'open') editor.requestOpenDocument()
  else if (key === 'add') editor.pickImage(hasDoc.value ? 'layer' : 'doc')
  else if (key === 'export') editor.exportPng()
}

function onEdit(key: string): void {
  closeMenus()
  if (key === 'undo') editor.undoEdit()
  else if (key === 'redo') editor.redoEdit()
  else if (key === 'deselect') editor.clearSelection()
}

function onImage(key: string): void {
  closeMenus()
  if (key === 'canvas-size') openSizeDialog('canvas')
  else if (key === 'fit-layer') editor.fitCanvasToLayer()
  else if (key === 'scale') openSizeDialog('scale')
  else if (key === 'crop-selection') editor.cropToSelection()
  else if (key === 'crop-content') editor.cropToContent()
}

function onLayer(key: string): void {
  closeMenus()
  if (key === 'rename') editor.startRename()
  else if (key === 'merge') editor.mergeDown()
  else if (key === 'up') editor.moveLayerBy(1)
  else if (key === 'down') editor.moveLayerBy(-1)
  else if (key === 'delete') editor.deleteLayer()
}
</script>

<template>
  <header class="topbar">
    <div class="brand" aria-label="PhotoAI">
      <AppIcon name="mark" class="brand-mark" :size="22" />
      <span class="wordmark">PhotoAI</span>
    </div>

    <nav ref="navEl" class="menu-bar" aria-label="主菜单">
      <n-dropdown
        trigger="click"
        placement="bottom-start"
        :show="openMenu === 'file'"
        :show-arrow="false"
        :options="fileOptions"
        @update:show="(v) => setMenuShow('file', v)"
        @select="onFile"
      >
        <button class="menu-btn" type="button" @mouseenter="onMenuHover('file')">文件</button>
      </n-dropdown>
      <n-dropdown
        trigger="click"
        placement="bottom-start"
        :show="openMenu === 'edit'"
        :show-arrow="false"
        :options="editOptions"
        @update:show="(v) => setMenuShow('edit', v)"
        @select="onEdit"
      >
        <button class="menu-btn" type="button" @mouseenter="onMenuHover('edit')">编辑</button>
      </n-dropdown>
      <n-dropdown
        trigger="click"
        placement="bottom-start"
        :show="openMenu === 'image'"
        :show-arrow="false"
        :options="imageOptions"
        @update:show="(v) => setMenuShow('image', v)"
        @select="onImage"
      >
        <button class="menu-btn" type="button" @mouseenter="onMenuHover('image')">图像</button>
      </n-dropdown>
      <n-dropdown
        trigger="click"
        placement="bottom-start"
        :show="openMenu === 'layer'"
        :show-arrow="false"
        :options="layerOptions"
        @update:show="(v) => setMenuShow('layer', v)"
        @select="onLayer"
      >
        <button class="menu-btn" type="button" @mouseenter="onMenuHover('layer')">图层</button>
      </n-dropdown>
    </nav>

    <span class="topbar-divider" aria-hidden="true" />

    <div class="doc-block">
      <h1 v-if="doc" class="doc-name">{{ doc.name }}</h1>
      <span v-else class="doc-name is-empty">未打开图片</span>
      <span v-if="doc" class="doc-dims">{{ doc.w }} × {{ doc.h }}</span>
      <span class="status-pill" :data-state="statusState">{{ statusText }}</span>
    </div>

    <div class="topbar-spacer" />

    <div class="topbar-actions">
      <n-tooltip placement="bottom" :show-arrow="false">
        <template #trigger>
          <n-button
            quaternary
            circle
            size="small"
            aria-label="撤销"
            :disabled="!canUndo"
            @click="editor.undoEdit()"
          >
            <template #icon><AppIcon name="undo" :size="17" /></template>
          </n-button>
        </template>
        撤销 <kbd class="menu-kbd">Ctrl Z</kbd>
      </n-tooltip>

      <n-tooltip placement="bottom" :show-arrow="false">
        <template #trigger>
          <n-button
            quaternary
            circle
            size="small"
            aria-label="重做"
            :disabled="!canRedo"
            @click="editor.redoEdit()"
          >
            <template #icon><AppIcon name="redo" :size="17" /></template>
          </n-button>
        </template>
        重做 <kbd class="menu-kbd">Ctrl Shift Z</kbd>
      </n-tooltip>

      <n-button
        class="export-btn"
        type="primary"
        size="small"
        aria-label="导出 PNG"
        :disabled="!canExport"
        @click="editor.exportPng()"
      >
        <template #icon><AppIcon name="download" :size="16" /></template>
        <span class="export-label">导出 PNG</span>
      </n-button>
    </div>
  </header>

  <ImageSizeDialog v-model:show="sizeDialog.show" :mode="sizeDialog.mode" @apply="applySize" />
</template>
