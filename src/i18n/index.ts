import { createI18n } from 'vue-i18n'
import en from './locales/en'
import fr from './locales/fr'

const LOCALE_KEY = 'powervoting-locale'

function getDefaultLocale(): string {
  if (typeof localStorage === 'undefined') return 'en'
  return (localStorage.getItem(LOCALE_KEY) as 'en' | 'fr') || 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: getDefaultLocale(),
  fallbackLocale: 'en',
  messages: {
    en,
    fr,
  },
})

export function setLocale(locale: 'en' | 'fr') {
  i18n.global.locale.value = locale
  try {
    localStorage.setItem(LOCALE_KEY, locale)
  } catch (_) {}
}

export function getLocale(): 'en' | 'fr' {
  return i18n.global.locale.value as 'en' | 'fr'
}
