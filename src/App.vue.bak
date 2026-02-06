<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div id="app">
    <header class="app-header">
      <div class="container">
        <div class="header-content">
          <h1 class="app-title">
            <span class="gradient-text">Power Voting REG</span>
            <span class="subtitle">Data Visualization & Analysis</span>
          </h1>
          <nav class="main-nav">
            <RouterLink to="/documentation">Documentation</RouterLink>
            <RouterLink to="/generate">Generate</RouterLink>
            <RouterLink to="/">Upload</RouterLink>
            <RouterLink to="/analysis">Analysis</RouterLink>
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
        <p>&copy; 2025 RealT Power Voting Analysis | A Realtoken DAO tool, created and managed by the Power Voting Committee</p>
      </div>
    </footer>
  </div>
</template>

<style>
:root {
  --primary-color: #6366f1;
  --primary-dark: #4f46e5;
  --secondary-color: #8b5cf6;
  --accent-color: #ec4899;
  --success-color: #10b981;
  --warning-color: #f59e0b;
  --error-color: #ef4444;
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-tertiary: #334155;
  --text-primary: #f8fafc;
  --text-secondary: #cbd5e1;
  --text-muted: #64748b;
  --border-color: #334155;
  --card-bg: rgba(30, 41, 59, 0.8);
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
  background: linear-gradient(135deg, var(--bg-primary) 0%, #1e1b4b 100%);
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

/* Header */
.app-header {
  background: var(--card-bg);
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

.app-title {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.gradient-text {
  background: linear-gradient(
    135deg,
    var(--primary-color) 0%,
    var(--secondary-color) 50%,
    var(--accent-color) 100%
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
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
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
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
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
  color: var(--text-primary);
  box-shadow: var(--shadow-md);
}

/* Main */
.app-main {
  flex: 1;
  padding: 2rem 0;
}

/* Footer */
.app-footer {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-top: 1px solid var(--border-color);
  padding: 1.5rem 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
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
