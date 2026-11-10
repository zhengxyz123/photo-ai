<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { useEditorContext } from '../editor/context'
import { TOOLS } from '../editor/useEditor'

const editor = useEditorContext()
const { tool } = editor
</script>

<template>
  <section class="tool-panel" aria-labelledby="tools-heading">
    <h2 id="tools-heading" class="section-title">工具</h2>
    <div class="tool-list" role="group" aria-label="工具">
      <button
        v-for="t in TOOLS"
        :key="t.value"
        class="tool-row"
        :class="{ active: tool === t.value }"
        type="button"
        :aria-pressed="tool === t.value"
        @click="editor.setTool(t.value)"
      >
        <AppIcon :name="t.icon" :size="18" class="tool-icon" />
        <span class="tool-label">{{ t.label }}</span>
        <kbd class="tool-key">{{ t.key }}</kbd>
      </button>
    </div>
  </section>
</template>
