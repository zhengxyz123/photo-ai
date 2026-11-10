<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  darkTheme,
  dateEnUS,
  dateZhCN,
  enUS,
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  zhCN,
} from 'naive-ui'
import PhotoEditor from './PhotoEditor.vue'
import { themeOverrides } from './theme'

const { locale } = useI18n()
// Naive UI's own widgets (color picker, inputs, dialogs) follow the same locale.
const naiveLocale = computed(() => (locale.value === 'zh-Hans' ? zhCN : enUS))
const naiveDateLocale = computed(() => (locale.value === 'zh-Hans' ? dateZhCN : dateEnUS))
</script>

<template>
  <n-config-provider
    :theme="darkTheme"
    :theme-overrides="themeOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
  >
    <n-dialog-provider>
      <n-message-provider placement="top-right" :max="3" :duration="5000">
        <PhotoEditor />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>
