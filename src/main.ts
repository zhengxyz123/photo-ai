// SPDX-License-Identifier: Apache-2.0
import { createApp } from 'vue'
import App from './App.vue'
import { i18n } from './i18n'
import './assets/fonts/inter.css'
import './styles.css'

createApp(App).use(i18n).mount('#app')
