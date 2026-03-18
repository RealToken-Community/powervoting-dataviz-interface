<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { setLocale } from '@/i18n'
import logoImg from '@/assets/logo-v3-orange.svg'

const { t } = useI18n()
</script>

<template>
  <div id="app">
    <header class="app-header">
      <div class="container">
        <div class="header-content">
          <RouterLink to="/" class="header-logo">
            <img :src="logoImg" alt="RealToken DAO" class="header-logo-img" />
            <h1 class="app-title">
              <span class="gradient-text">{{ t('app.title') }}</span>
              <span class="subtitle">{{ t('app.subtitle') }}</span>
            </h1>
          </RouterLink>
          <nav class="main-nav">
            <RouterLink to="/search">{{ t('nav.search') }}</RouterLink>
            <RouterLink to="/history">{{ t('nav.history') }}</RouterLink>
            <RouterLink to="/generate">{{ t('nav.generate') }}</RouterLink>
            <RouterLink to="/upload">{{ t('nav.upload') }}</RouterLink>
            <RouterLink to="/vote">{{ t('nav.vote') }}</RouterLink>
            <!-- <RouterLink to="/analysis">{{ t('nav.analysis') }}</RouterLink> -->
            <span class="lang-switcher">
              <button type="button" class="lang-btn" :class="{ active: $i18n.locale === 'en' }" @click="setLocale('en')">{{ t('nav.langEn') }}</button>
              <span class="lang-sep">|</span>
              <button type="button" class="lang-btn" :class="{ active: $i18n.locale === 'fr' }" @click="setLocale('fr')">{{ t('nav.langFr') }}</button>
            </span>
          </nav>
        </div>
      </div>
    </header>

    <main class="app-main">
      <div class="container">
        <RouterView />
      </div>
    </main>

    <footer class="app-footer">
      <div class="container">
        <img :src="logoImg" alt="RealToken DAO" class="footer-logo-img" />
        <p>{{ t('app.footer') }}</p>
      </div>
    </footer>
  </div>
</template>

<style>
:root {
  /* DAO palette (docs/00-design.md) */
  --color-navy: #091A3A;
  --color-charcoal: #242424;
  --color-white: #FFFFFF;
  --color-orange: #FF8C42;
  --primary-color: #FF8C42;
  --primary-dark: #e67a35;
  --secondary-color: #ffb97a;
  --accent-color: #FF8C42;
  --success-color: #10b981;
  --warning-color: #f59e0b;
  --error-color: #ef4444;
  --bg-primary: #091A3A;
  --bg-secondary: #242424;
  --bg-tertiary: #2d2d2d;
  --text-primary: #FFFFFF;
  --text-secondary: #e2e8f0;
  --text-muted: #94a3b8;
  --border-color: rgba(255, 255, 255, 0.1);
  /* Fond des sections de contenu (cartes, panneaux) = Charcoal */
  --card-bg: #242424;
  --section-bg: #242424;
  --glass-bg: rgba(255, 255, 255, 0.05);
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
  --shadow-xl: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family:
    'Inter',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    Oxygen,
    Ubuntu,
    Cantarell,
    sans-serif;
  background: linear-gradient(135deg, var(--bg-primary) 0%, var(--color-charcoal) 100%);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
}

#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 2rem;
}

/* Header (reste comme avant : navy, pas charcoal) */
.app-header {
  background: rgba(9, 26, 58, 0.95);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border-color);
  padding: 1.5rem 0;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: var(--shadow-md);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}

.header-logo {
  display: flex;
  align-items: center;
  gap: 1rem;
  text-decoration: none;
  color: inherit;
}

.header-logo-img {
  height: 44px;
  width: auto;
  display: block;
  flex-shrink: 0;
}

.app-title {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.gradient-text {
  color: var(--primary-color);
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.subtitle {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 400;
}

.main-nav {
  display: flex;
  gap: 0.5rem;
}

.main-nav a {
  padding: 0.625rem 1.25rem;
  border-radius: 0.5rem;
  text-decoration: none;
  color: var(--text-secondary);
  font-weight: 500;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.main-nav a::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--primary-color);
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: -1;
}

.main-nav a:hover {
  color: var(--text-primary);
  transform: translateY(-2px);
}

.main-nav a:hover::before {
  opacity: 0.2;
}

.main-nav a.router-link-active {
  background: var(--primary-color);
  color: var(--text-primary);
  box-shadow: var(--shadow-md);
}

.lang-switcher {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: 0.5rem;
  padding-left: 0.75rem;
  border-left: 1px solid var(--border-color);
}

.lang-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;
  transition: color 0.2s, background 0.2s;
}

.lang-btn:hover {
  color: var(--text-primary);
}

.lang-btn.active {
  color: var(--primary-color);
  font-weight: 600;
}

.lang-sep {
  color: var(--text-muted);
  font-size: 0.75rem;
}

/* Main */
.app-main {
  flex: 1;
  padding: 2rem 0;
}

/* Footer (reste comme avant : navy, pas charcoal) */
.app-footer {
  background: rgba(9, 26, 58, 0.95);
  backdrop-filter: blur(10px);
  border-top: 1px solid var(--border-color);
  padding: 1.5rem 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.app-footer .container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.footer-logo-img {
  height: 40px;
  width: auto;
  display: block;
}

/* Animations */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* Responsive */
@media (max-width: 768px) {
  .header-content {
    flex-direction: column;
    align-items: flex-start;
  }

  .gradient-text {
    font-size: 1.5rem;
  }

  .container {
    padding: 0 1rem;
  }
}
</style>
