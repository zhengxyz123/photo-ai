<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton, NDropdown, NInput } from 'naive-ui'
import Sortable from 'sortablejs'
import AppIcon from './AppIcon.vue'
import LayerThumb from './LayerThumb.vue'
import SolidColorDialog from './SolidColorDialog.vue'
import { useEditorContext } from '../editor/context'
import type { Layer } from '../types/editor'

const editor = useEditorContext()
const {
  layers,
  activeId,
  activeLayer,
  hasDoc,
  busy,
  canMergeDown,
  canDeleteLayer,
  thumbRev,
  renamingId,
  selectLayer,
  startRename,
  renameLayer,
  mergeDown,
  deleteLayer,
  reorderLayers,
  canMergeLayer,
  pickImage,
} = editor

const listEl = ref<HTMLOListElement | null>(null)
let sortable: Sortable | null = null
const draft = ref('')
const solidOpen = ref(false)

const addOptions = computed(() => [
  {
    key: 'image',
    label: hasDoc.value ? '新增图片图层' : '打开图片',
  },
  {
    key: 'solid',
    label: '新增纯色图层',
  },
])

function onAdd(key: string): void {
  editor.setMenuOpen(false)
  if (key === 'image') pickImage(hasDoc.value ? 'layer' : 'doc')
  else if (key === 'solid') solidOpen.value = true
}

const displayLayers = computed(() => [...layers.value].reverse())

watch(renamingId, async (id) => {
  if (!id) return
  const layer = layers.value.find((l) => l.id === id)
  if (!layer) return
  draft.value = layer.name
  await nextTick()
  listEl.value?.querySelector<HTMLInputElement>('.rename-input input')?.focus()
})

watch(
  () => busy.active,
  (v) => sortable?.option('disabled', v),
)

function commitRename(layer: Layer): void {
  if (renamingId.value !== layer.id) return
  if (!draft.value.trim()) {
    renamingId.value = null
    return
  }
  renameLayer(layer.id, draft.value)
}

function cancelRename(): void {
  renamingId.value = null
}

function beginRename(layer: Layer): void {
  startRename(layer.id)
}

function rowOptions(layer: Layer) {
  return [
    { key: 'rename', label: '重命名', disabled: busy.active },
    { key: 'merge', label: '向下合并', disabled: !canMergeLayer(layer) },
    { type: 'divider', key: 'divider' },
    { key: 'delete', label: '删除图层', disabled: !canDeleteLayer.value },
  ]
}

function onRowAction(layer: Layer, key: string): void {
  editor.setMenuOpen(false)
  if (key === 'rename') beginRename(layer)
  else if (key === 'merge') mergeDown(layer.id)
  else if (key === 'delete') deleteLayer(layer.id)
}

onMounted(() => {
  if (!listEl.value) return
  sortable = Sortable.create(listEl.value, {
    animation: 160,
    handle: '.layer-grip',
    ghostClass: 'layer-ghost',
    chosenClass: 'layer-chosen',
    dragClass: 'layer-drag',
    forceFallback: false,
    onEnd(evt) {
      if (evt.oldIndex == null || evt.newIndex == null || evt.oldIndex === evt.newIndex) return
      reorderLayers(evt.oldIndex, evt.newIndex)
    },
  })
  sortable.option('disabled', busy.active)
})

onBeforeUnmount(() => {
  sortable?.destroy()
  sortable = null
})
</script>

<template>
  <section class="layer-panel" aria-labelledby="layers-heading">
    <div class="panel-head">
      <div class="head-left">
        <h2 id="layers-heading" class="section-title">图层</h2>
        <span class="section-meta">{{ layers.length }} 层</span>
      </div>
      <n-dropdown
        trigger="click"
        placement="bottom-end"
        :show-arrow="false"
        :options="addOptions"
        @update:show="editor.setMenuOpen"
        @select="onAdd"
      >
        <n-button class="add-btn" secondary size="tiny">
          <template #icon><AppIcon name="plus" :size="14" /></template>
          {{ hasDoc ? '新增图层' : '打开图片' }}
          <AppIcon class="add-caret" name="arrowDown" :size="12" />
        </n-button>
      </n-dropdown>
    </div>

    <div v-if="!layers.length" class="layer-empty">
      <AppIcon name="image" :size="26" class="layer-empty-icon" />
      <p class="layer-empty-title">还没有图层</p>
      <p>打开图片后会叠在这里。</p>
      <n-button secondary size="small" @click="pickImage('doc')">打开图片</n-button>
    </div>

    <ol
      ref="listEl"
      class="layer-list"
      :class="{ 'is-empty': !displayLayers.length }"
      aria-label="图层，从上到下"
    >
      <li
        v-for="layer in displayLayers"
        :key="layer.id"
        class="layer-row"
        :class="{ active: layer.id === activeId }"
        role="button"
        tabindex="0"
        :aria-pressed="layer.id === activeId"
        :aria-label="`图层 ${layer.name}`"
        @click="selectLayer(layer.id)"
        @dblclick="beginRename(layer)"
        @keydown.enter.prevent="selectLayer(layer.id)"
        @keydown.space.prevent="selectLayer(layer.id)"
        @keydown.f2.prevent="beginRename(layer)"
      >
        <button
          class="layer-grip"
          type="button"
          aria-label="拖动以调整图层顺序"
          title="拖动排序"
          @click.stop
        >
          <AppIcon name="grip" :size="16" />
        </button>

        <LayerThumb :layer="layer" :thumb-rev="thumbRev" />

        <div class="layer-body">
          <n-input
            v-if="renamingId === layer.id"
            v-model:value="draft"
            class="rename-input"
            size="tiny"
            :maxlength="48"
            @click.stop
            @blur="commitRename(layer)"
            @keydown.enter.prevent="commitRename(layer)"
            @keydown.esc.prevent="cancelRename"
          />
          <span v-else class="layer-name">{{ layer.name }}</span>
        </div>

        <n-dropdown
          trigger="click"
          placement="bottom-end"
          :show-arrow="false"
          :options="rowOptions(layer)"
          @update:show="editor.setMenuOpen"
          @select="(key) => onRowAction(layer, key)"
        >
          <n-button
            class="layer-more"
            quaternary
            circle
            size="tiny"
            aria-label="图层操作"
            @click.stop
          >
            <template #icon><AppIcon name="more" :size="16" /></template>
          </n-button>
        </n-dropdown>
      </li>
    </ol>

    <div class="layer-actions">
      <n-button secondary size="small" block :disabled="!canMergeDown" @click="mergeDown()">
        <template #icon><AppIcon name="merge" :size="15" /></template>
        向下合并
      </n-button>
      <n-button
        secondary
        size="small"
        block
        :disabled="!activeLayer || busy.active"
        @click="startRename()"
      >
        <template #icon><AppIcon name="pencil" :size="15" /></template>
        重命名
      </n-button>
    </div>

    <p class="layer-tip">拖动图层可调整顺序，向下合并会并入下一层。</p>

    <SolidColorDialog v-model:show="solidOpen" />
  </section>
</template>
