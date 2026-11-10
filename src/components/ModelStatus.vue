<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorContext } from '../editor/context'
import type { ModelState } from '../types/editor'

const { t } = useI18n()
const editor = useEditorContext()
const { model } = editor

function pct(m: ModelState): number {
  if (!m.total) return 0
  return Math.min(100, Math.round((m.loaded / m.total) * 100))
}

function text(m: ModelState, idleKey: string): string {
  if (m.state === 'loading') {
    return m.total ? t('models.loadingPct', { pct: pct(m) }) : t('models.loading')
  }
  if (m.state === 'ready') return t('models.ready')
  if (m.state === 'error') return t('models.unavailable')
  return t(idleKey)
}

const samText = computed(() => text(model.sam, 'models.preparing'))
const lamaText = computed(() => text(model.lama, 'models.onDemand'))
const samBusy = computed(() => model.sam.state === 'loading')
const lamaBusy = computed(() => model.lama.state === 'loading')
const samPct = computed(() => pct(model.sam))
const lamaPct = computed(() => pct(model.lama))
</script>

<template>
  <section class="model-block" aria-labelledby="models-heading" aria-live="polite">
    <h2 id="models-heading" class="section-title">{{ t('models.heading') }}</h2>

    <div class="model-row">
      <span class="model-dot" :class="`is-${model.sam.state}`" aria-hidden="true" />
      <span class="model-name">{{ t('models.selection') }}</span>
      <span class="model-value">{{ samText }}</span>
    </div>
    <div
      v-if="samBusy"
      class="model-bar"
      :class="{ 'is-indeterminate': !model.sam.total }"
      aria-hidden="true"
    >
      <span :style="model.sam.total ? { width: samPct + '%' } : undefined" />
    </div>

    <div class="model-row">
      <span class="model-dot" :class="`is-${model.lama.state}`" aria-hidden="true" />
      <span class="model-name">{{ t('models.inpainting') }}</span>
      <span class="model-value">{{ lamaText }}</span>
    </div>
    <div
      v-if="lamaBusy"
      class="model-bar"
      :class="{ 'is-indeterminate': !model.lama.total }"
      aria-hidden="true"
    >
      <span :style="model.lama.total ? { width: lamaPct + '%' } : undefined" />
    </div>

    <p class="model-note">{{ t('models.note') }}</p>
  </section>
</template>
