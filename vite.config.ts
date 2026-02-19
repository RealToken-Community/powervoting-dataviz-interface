import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 0, // Pas de timeout pour les connexions SSE (EventSource)
      },
      '/generated': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    watch: {
      // Exclure complètement le dossier balance-calculator du watch
      // pour éviter les rechargements lors du clonage/rebuild
      // Utiliser une fonction pour une exclusion plus stricte qui fonctionne avec chokidar
      ignored: [
        // Patterns glob pour exclure balance-calculator
        '**/balance-calculator/**',
        '**/balance-calculator',
        // Exclure aussi les chemins absolus possibles
        /.*[\/\\]balance-calculator[\/\\].*/,
        /.*[\/\\]balance-calculator$/,
      ],
    },
    // Désactiver le HMR pour les fichiers dans balance-calculator
    hmr: {
      overlay: true,
    },
    // Désactiver le polling pour éviter de détecter les changements
    fs: {
      // Ne pas servir les fichiers de balance-calculator
      deny: ['**/balance-calculator/**'],
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true
  }
})
