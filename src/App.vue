<script setup lang="ts">
import { darkTheme, NConfigProvider, NDialogProvider, NMessageProvider } from 'naive-ui'
import PhotoEditor from './PhotoEditor.vue'
import { themeOverrides } from './theme'
</script>

<template>
  <n-config-provider :theme="darkTheme" :theme-overrides="themeOverrides">
    <n-dialog-provider>
      <n-message-provider placement="top-right" :max="3" :duration="5000">
        <PhotoEditor />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>
