<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDataStore } from '@/stores/dataStore'
import { loadSnapshotManifest, loadSnapshot, type SnapshotInfo } from '@/utils/snapshotLoader'
import AnalysisView from '@/views/AnalysisView.vue'

const route = useRoute()
const router = useRouter()
const dataStore = useDataStore()
const snapshots = ref<SnapshotInfo[]>([])
const selectedSnapshot = ref<SnapshotInfo | null>(null)
const isLoading = ref(true)
const isLoadingSnapshot = ref(false)
const error = ref<string>('')

function findSnapshotByDate(date: string): SnapshotInfo | undefined {
  return snapshots.value.find((s) => s.date === date)
}

async function applySnapshotFromRoute() {
  const date = route.params.date as string | undefined
  if (!date || snapshots.value.length === 0) return
  const snapshot = findSnapshotByDate(date)
  if (snapshot && snapshot.date !== selectedSnapshot.value?.date) {
    await selectSnapshot(snapshot, false)
  }
}

onMounted(async () => {
  try {
    snapshots.value = await loadSnapshotManifest()
    if (snapshots.value.length > 0) {
      const dateFromUrl = route.params.date as string | undefined
      const snapshot = dateFromUrl ? findSnapshotByDate(dateFromUrl) : null
      if (snapshot) {
        await selectSnapshot(snapshot, false)
      } else {
        await selectSnapshot(snapshots.value[0], false)
        if (dateFromUrl) {
          router.replace('/')
        }
      }
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors du chargement des snapshots'
  } finally {
    isLoading.value = false
  }
})

watch(
  () => route.params.date,
  () => {
    if (snapshots.value.length > 0) applySnapshotFromRoute()
  }
)

const selectSnapshot = async (snapshot: SnapshotInfo, updateUrl = false) => {
  if (selectedSnapshot.value?.date === snapshot.date) return
  isLoadingSnapshot.value = true
  error.value = ''
  try {
    const { balances, powerVoting } = await loadSnapshot(snapshot)
    dataStore.setBalancesData(balances)
    dataStore.setPowerVotingData(powerVoting)
    selectedSnapshot.value = snapshot
    if (updateUrl) {
      router.replace(`/${snapshot.date}`)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors du chargement du snapshot'
  } finally {
    isLoadingSnapshot.value = false
  }
}

const formatNumber = (num: number) => {
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M'
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'k'
  return num.toFixed(0)
}
</script>

<template>
  <div class="home-view">
    <section class="home-intro">
        <h2 class="home-intro-title">Pouvoir de vote</h2>
        <p class="home-intro-text">
          Le pouvoir de vote (Power Voting) reflète le poids d’un participant dans les décisions de la Realtoken DAO.
          Il est calculé à partir des positions REG (Real Estate Token) détenues en wallet et dans les pools de liquidité,
          avec des multiplicateurs selon le type de pool (V2, V3) et l’état des positions.
        </p>
        <p class="home-intro-text">
          Chaque snapshot fixe un instantané des balances et du pouvoir de vote à une date donnée.
          Sélectionnez un snapshot ci-dessous pour explorer les données et visualiser les graphiques.
        </p>
    </section>

    <aside class="home-left">
      <section class="home-snapshots">
        <h3 class="home-snapshots-title">Snapshots</h3>
        <div v-if="error" class="home-error">{{ error }}</div>
        <div v-else-if="isLoading" class="home-loading">Chargement...</div>
        <ul v-else-if="snapshots.length > 0" class="home-list">
          <li
            v-for="snapshot in snapshots"
            :key="snapshot.date"
            class="home-list-item"
            :class="{ 'home-list-item-active': selectedSnapshot?.date === snapshot.date }"
          >
            <button
              type="button"
              class="home-list-btn"
              :disabled="isLoadingSnapshot"
              @click="selectSnapshot(snapshot, true)"
            >
              <span class="home-list-date">{{ snapshot.dateFormatted }}</span>
              <template v-if="snapshot.metrics">
                <span class="home-list-meta">{{ snapshot.metrics.walletCount }} portefeuilles · REG {{ formatNumber(snapshot.metrics.totalREG) }}</span>
              </template>
            </button>
          </li>
        </ul>
        <p v-else class="home-empty">Aucun snapshot disponible.</p>
      </section>
    </aside>

    <main class="home-right">
      <Transition name="analysis-transition" mode="out-in">
        <div v-if="isLoadingSnapshot" key="loading" class="home-right-placeholder">
          <span class="home-placeholder-spinner"></span>
          <p>Chargement du snapshot...</p>
        </div>
        <div v-else-if="!selectedSnapshot" key="empty" class="home-right-placeholder">
          <p>Choisissez un snapshot dans la liste pour afficher l’analyse.</p>
        </div>
        <AnalysisView
          v-else
          :key="selectedSnapshot.date"
          embedded
        />
      </Transition>
    </main>
  </div>
</template>

<style scoped>
.home-view {
  display: grid;
  grid-template-columns: 1fr 3fr;
  grid-template-rows: auto 1fr;
  gap: 2rem;
  align-items: start;
  min-height: calc(100vh - 200px);
}

.home-intro {
  grid-column: 1 / -1;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 1rem;
  padding: 1.5rem;
}

.home-left {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.home-intro-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--primary-color);
  margin: 0 0 0.75rem 0;
}

.home-intro-text {
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 0.75rem 0;
}

.home-intro-text:last-child {
  margin-bottom: 0;
}

.home-snapshots {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 1rem;
  padding: 1rem;
}

.home-snapshots-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.75rem 0;
  padding: 0 0.25rem;
}

.home-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.home-list-item {
  margin-bottom: 0.25rem;
}

.home-list-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.75rem 1rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}

.home-list-btn:hover:not(:disabled) {
  background: var(--glass-bg);
  border-color: var(--border-color);
}

.home-list-item-active .home-list-btn {
  background: rgba(255, 140, 66, 0.15);
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.home-list-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.home-list-date {
  display: block;
  font-weight: 600;
  font-size: 0.95rem;
}

.home-list-meta {
  display: block;
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
}

.home-error {
  padding: 0.75rem;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 0.5rem;
  color: var(--error-color);
  font-size: 0.875rem;
}

.home-loading,
.home-empty {
  padding: 1rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin: 0;
}

.home-right {
  min-width: 0;
  min-height: 400px;
}

.home-right-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 2rem;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 1rem;
  color: var(--text-secondary);
  text-align: center;
}

.home-placeholder-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: home-spin 0.8s linear infinite;
  margin-bottom: 1rem;
}

@keyframes home-spin {
  to { transform: rotate(360deg); }
}

/* Transition entre changements de snapshot */
.analysis-transition-enter-active,
.analysis-transition-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.analysis-transition-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.analysis-transition-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

@media (max-width: 900px) {
  .home-view {
    grid-template-columns: 1fr;
  }

  .home-left {
    position: static;
  }
}
</style>
