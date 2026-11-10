<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from './AppIcon.vue'
import { useEditorContext } from '../editor/context'
import { TOOLS } from '../editor/useEditor'

const { t } = useI18n()
const editor = useEditorContext()
const { tool } = editor
</script>

<template>
  <section class="tool-panel" aria-labelledby="tools-heading">
    <h2 id="tools-heading" class="section-title">{{ t('tools.heading') }}</h2>
    <div class="tool-list" role="group" :aria-label="t('tools.aria')">
      <button
        v-for="item in TOOLS"
        :key="item.value"
        class="tool-row"
        :class="{ active: tool === item.value }"
        type="button"
        :aria-pressed="tool === item.value"
        @click="editor.setTool(item.value)"
      >
        <AppIcon :name="item.icon" :size="18" class="tool-icon" />
        <span class="tool-label">{{ t(item.labelKey) }}</span>
        <kbd class="tool-key">{{ item.key }}</kbd>
      </button>
    </div>
  </section>
</template>
