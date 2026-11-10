// SPDX-License-Identifier: Apache-2.0
// Locale registry, persistence and the document-level language metadata.
//
// English is the source language; Simplified Chinese is a full translation.
// The choice is stored per browser and survives reloads.
import { createI18n } from 'vue-i18n'
import en from './locales/en'
import zhHans from './locales/zh-Hans'

export type Locale = 'en' | 'zh-Hans'

export interface LocaleOption {
  value: Locale
  /** Autonym: a language is always listed in its own language. */
  label: string
  htmlLang: string
}

export const LOCALES: readonly LocaleOption[] = [
  { value: 'en', label: 'English', htmlLang: 'en' },
  { value: 'zh-Hans', label: '简体中文', htmlLang: 'zh-CN' },
]

export const DEFAULT_LOCALE: Locale = 'en'

const STORAGE_KEY = 'photoai.locale'

type DeepStringRecord<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends object ? DeepStringRecord<T[K]> : T[K]
}

export type MessageSchema = DeepStringRecord<typeof en>

const messages = { en, 'zh-Hans': zhHans } satisfies Record<Locale, MessageSchema>

function isLocale(value: unknown): value is Locale {
  return LOCALES.some((option) => option.value === value)
}

function storedLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    // Storage can be blocked; fall back to the source language.
  }
  return DEFAULT_LOCALE
}

export const i18n = createI18n({
  legacy: false,
  locale: storedLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  messages,
})

export function currentLocale(): Locale {
  const value = i18n.global.locale.value
  return isLocale(value) ? value : DEFAULT_LOCALE
}

/** Translate outside a component (editor helpers, tests, metadata). */
export function translate(key: string, named?: Record<string, unknown>): string {
  const t = i18n.global.t as unknown as (key: string, named?: Record<string, unknown>) => string
  return named ? t(key, named) : t(key)
}

function localeOption(value: Locale): LocaleOption {
  return LOCALES.find((option) => option.value === value) ?? LOCALES[0]
}

function applyDocumentLocale(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = localeOption(currentLocale()).htmlLang
  const meta = document.querySelector('meta[name="description"]')
  if (meta) meta.setAttribute('content', translate('app.description'))
}

export function setLocale(next: Locale): void {
  if (!isLocale(next)) return
  i18n.global.locale.value = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // The switch still applies for this session.
  }
  applyDocumentLocale()
}

applyDocumentLocale()
