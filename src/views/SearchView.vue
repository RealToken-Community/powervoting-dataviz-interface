<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '@/stores/dataStore'
import { loadSnapshotManifest, loadSnapshot } from '@/utils/snapshotLoader'
import AnalysisView from './AnalysisView.vue'

const { t } = useI18n()
const dataStore = useDataStore()
const isLoadingSnapshot = ref(true)
const hasSnapshot = ref(false)
const loadError = ref<string | null>(null)

onMounted(async () => {
  isLoadingSnapshot.value = true
  loadError.value = null
  hasSnapshot.value = false
  try {
    const snapshots = await loadSnapshotManifest()
    if (snapshots.length === 0) {
      loadError.value = t('home.noSnapshot')
      return
    }
    const latest = snapshots[0]
    const { balances, powerVoting } = await loadSnapshot(latest)
    dataStore.setBalancesData(balances)
    dataStore.setPowerVotingData(powerVoting)
    dataStore.setCurrentSnapshotDate(latest.date)
    hasSnapshot.value = true
  } catch (err) {
    console.error('Failed to load latest snapshot:', err)
    loadError.value = t('home.errorLoadSnapshot')
  } finally {
    isLoadingSnapshot.value = false
  }
})
</script>

<template>
  <div class="search-view">
    <header class="search-view-header">
      <h1 class="search-view-title">{{ t('search.title') }}</h1>
      <p class="search-view-subtitle">{{ t('search.subtitle') }}</p>
    </header>

    <div v-if="isLoadingSnapshot" class="search-view-loading">
      <p>{{ t('home.loadingSnapshot') }}</p>
    </div>
    <p v-else-if="loadError" class="search-view-error">{{ loadError }}</p>
    <AnalysisView v-else-if="hasSnapshot" search-only />
  </div>
</template>

<style scoped>
.search-view {
  padding: 2rem 0;
}
.search-view-header {
  margin-bottom: 2rem;
}
.search-view-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
}
.search-view-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}
.search-view-loading,
.search-view-error {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
  background: var(--card-bg);
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
}
.search-view-error {
  color: var(--error-color);
}
</style>
