<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '@/stores/dataStore'
import { loadSnapshotManifest, loadSnapshot, type SnapshotInfo } from '@/utils/snapshotLoader'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
} from 'chart.js'

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
)

const router = useRouter()
const { t } = useI18n()
const dataStore = useDataStore()

const snapshots = ref<SnapshotInfo[]>([])
const isLoadingSnapshots = ref(true)
const isLoading = ref(false)
const error = ref<string>('')

onMounted(async () => {
  isLoadingSnapshots.value = true
  try {
    snapshots.value = await loadSnapshotManifest()
  } catch (err) {
    console.error('Failed to load snapshots:', err)
    error.value = t('home.errorLoadSnapshots')
  } finally {
    isLoadingSnapshots.value = false
  }
})

const loadSnapshotData = async (snapshot: SnapshotInfo) => {
  isLoading.value = true
  error.value = ''
  try {
    const { balances, powerVoting } = await loadSnapshot(snapshot)
    dataStore.setBalancesData(balances)
    dataStore.setPowerVotingData(powerVoting)
    dataStore.setCurrentSnapshotDate(snapshot.date)
    await router.push('/analysis')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('home.errorLoadSnapshot')
  } finally {
    isLoading.value = false
  }
}

const formatSnapshotDate = (dateStr: string) => {
  const [day, month, year] = dateStr.split('-')
  return new Date(`${year}-${month}-${day}`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const formatNumber = (num: number) => {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}

const formatInteger = (num: number) => {
  return new Intl.NumberFormat('fr-FR').format(Math.round(num))
}

const getSnapshotDiff = (snapshot: SnapshotInfo) => {
  if (!snapshot.metrics || snapshots.value.length === 0) return null
  const currentIndex = snapshots.value.findIndex((s) => s.date === snapshot.date)
  if (currentIndex === -1) return null
  const previousSnapshot = snapshots.value[currentIndex + 1]
  if (!previousSnapshot || !previousSnapshot.metrics) return null
  return {
    walletCount: snapshot.metrics.walletCount - previousSnapshot.metrics.walletCount,
    totalREG: snapshot.metrics.totalREG - previousSnapshot.metrics.totalREG,
    totalPowerVoting: snapshot.metrics.totalPowerVoting - previousSnapshot.metrics.totalPowerVoting,
  }
}

const formatDiff = (diff: number, isInteger = false) => {
  if (diff === 0) return ''
  const formatted = isInteger ? formatInteger(Math.abs(diff)) : formatNumber(Math.abs(diff))
  return diff > 0 ? `+${formatted}` : `-${formatted}`
}

const snapshotsChartData = computed(() => {
  if (snapshots.value.length === 0) return null
  const snapshotsWithMetrics = snapshots.value
    .filter((s) => s.metrics)
    .sort((a, b) => {
      const dateA = new Date(a.dateFormatted || a.date.split('-').reverse().join('-'))
      const dateB = new Date(b.dateFormatted || b.date.split('-').reverse().join('-'))
      return dateA.getTime() - dateB.getTime()
    })
  if (snapshotsWithMetrics.length === 0) return null
  const labels = snapshotsWithMetrics.map((s) => formatSnapshotDate(s.date))
  const totalREG = snapshotsWithMetrics.map((s) => s.metrics!.totalREG)
  const totalPowerVoting = snapshotsWithMetrics.map((s) => s.metrics!.totalPowerVoting)
  return {
    labels,
    datasets: [
      {
        label: 'Total REG',
        data: totalREG,
        borderColor: 'rgb(34, 197, 94)',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        tension: 0.4,
        yAxisID: 'y1',
        borderWidth: 2,
      },
      {
        label: 'Total Power Voting',
        data: totalPowerVoting,
        borderColor: 'rgb(236, 72, 153)',
        backgroundColor: 'rgba(236, 72, 153, 0.1)',
        tension: 0.4,
        yAxisID: 'y2',
        borderWidth: 2,
      },
    ],
  }
})

const snapshotsChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
      labels: { color: 'rgb(255, 255, 255)', usePointStyle: true, padding: 15 },
    },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      titleColor: 'rgb(255, 255, 255)',
      bodyColor: 'rgb(255, 255, 255)',
      callbacks: {
        label: (context: any) => {
          let label = context.dataset.label || ''
          if (label) label += ': '
          label += formatNumber(context.parsed.y)
          return label
        },
      },
    },
  },
  scales: {
    x: {
      ticks: { color: 'rgb(255, 255, 255)', maxRotation: 45, minRotation: 45 },
      grid: { color: 'rgba(255, 255, 255, 0.2)' },
    },
    y1: {
      type: 'linear' as const,
      display: true,
      position: 'left' as const,
      ticks: { color: 'rgb(255, 255, 255)', callback: (value: any) => formatNumber(value) },
      grid: { color: 'rgba(255, 255, 255, 0.2)' },
      title: { display: true, text: 'Total REG', color: 'rgb(34, 197, 94)' },
    },
    y2: {
      type: 'linear' as const,
      display: true,
      position: 'right' as const,
      ticks: { color: 'rgb(255, 255, 255)', callback: (value: any) => formatNumber(value) },
      grid: { drawOnChartArea: false },
      title: { display: true, text: 'Total Power Voting', color: 'rgb(236, 72, 153)' },
    },
  },
  interaction: { mode: 'nearest' as const, axis: 'x' as const, intersect: false },
}))
</script>

<template>
  <div class="history-view">
    <header class="history-header">
      <h1 class="history-title">{{ t('history.title') }}</h1>
      <p class="history-subtitle">{{ t('history.subtitle') }}</p>
    </header>

    <p v-if="error" class="history-error">{{ error }}</p>

    <div v-else-if="isLoadingSnapshots" class="history-loading">
      {{ t('home.loadingSnapshot') }}
    </div>

    <div v-else-if="snapshots.length === 0" class="history-empty">
      {{ t('home.noSnapshot') }}
    </div>

    <div v-else class="snapshots-section">
      <div class="snapshots-header">
        <h3>📸 {{ t('upload.snapshotsHistory', { count: snapshots.length }) }}</h3>
        <p class="snapshots-header-desc" v-html="t('history.clickToLoad')"></p>
      </div>

      <div class="snapshots-list">
        <button
          v-for="snapshot in snapshots"
          :key="snapshot.date"
          @click="loadSnapshotData(snapshot)"
          :disabled="isLoading"
          class="snapshot-row"
          type="button"
          :title="t('upload.loadSnapshotTitle', { date: formatSnapshotDate(snapshot.date) })"
        >
          <div class="snapshot-date-col">
            <div class="snapshot-date">{{ formatSnapshotDate(snapshot.date) }}</div>
            <span class="snapshot-click-hint">{{ t('upload.clickToViewAnalysis') }}</span>
          </div>
          <div class="snapshot-metrics-row" v-if="snapshot.metrics">
            <div class="snapshot-metric-item">
              <span class="metric-icon">👥</span>
              <div class="metric-content">
                <div class="metric-value-row">
                  <span class="metric-value">{{ formatInteger(snapshot.metrics.walletCount) }}</span>
                  <span
                    v-if="getSnapshotDiff(snapshot)"
                    class="metric-diff"
                    :class="getSnapshotDiff(snapshot)!.walletCount >= 0 ? 'positive' : 'negative'"
                  >
                    {{ formatDiff(getSnapshotDiff(snapshot)!.walletCount, true) }}
                  </span>
                </div>
                <span class="metric-label">wallets</span>
              </div>
            </div>
            <div class="snapshot-metric-item">
              <span class="metric-icon">💰</span>
              <div class="metric-content">
                <div class="metric-value-row">
                  <span class="metric-value">{{ formatNumber(snapshot.metrics.totalREG) }}</span>
                  <span
                    v-if="getSnapshotDiff(snapshot)"
                    class="metric-diff"
                    :class="getSnapshotDiff(snapshot)!.totalREG >= 0 ? 'positive' : 'negative'"
                  >
                    {{ formatDiff(getSnapshotDiff(snapshot)!.totalREG) }}
                  </span>
                </div>
                <span class="metric-label">{{ t('upload.metricReg') }}</span>
              </div>
            </div>
            <div class="snapshot-metric-item">
              <span class="metric-icon">⚡</span>
              <div class="metric-content">
                <div class="metric-value-row">
                  <span class="metric-value">{{ formatNumber(snapshot.metrics.totalPowerVoting) }}</span>
                  <span
                    v-if="getSnapshotDiff(snapshot)"
                    class="metric-diff"
                    :class="getSnapshotDiff(snapshot)!.totalPowerVoting >= 0 ? 'positive' : 'negative'"
                  >
                    {{ formatDiff(getSnapshotDiff(snapshot)!.totalPowerVoting) }}
                  </span>
                </div>
                <span class="metric-label">{{ t('upload.metricPower') }}</span>
              </div>
            </div>
          </div>
          <div class="snapshot-files" v-else>
            <span class="snapshot-file">📄 {{ snapshot.balancesFile }}</span>
            <span class="snapshot-file">⚡ {{ snapshot.powerVotingFile }}</span>
          </div>
        </button>
      </div>

      <div class="snapshots-chart-container" v-if="snapshotsChartData">
        <Line :data="snapshotsChartData" :options="snapshotsChartOptions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-view {
  padding: 2rem 0;
  animation: fadeIn 0.5s ease;
}
.history-header {
  margin-bottom: 2rem;
}
.history-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
}
.history-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}
.history-loading,
.history-empty,
.history-error {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
  background: var(--card-bg);
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
}
.history-error {
  color: var(--error-color);
}

.snapshots-section {
  margin: 3rem 0;
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 2rem;
  box-shadow: var(--shadow-lg);
}
.snapshots-header {
  text-align: center;
  margin-bottom: 2rem;
}
.snapshots-header h3 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}
.snapshots-header p {
  color: var(--text-secondary);
  font-size: 0.95rem;
}
.snapshots-header-desc {
  max-width: 520px;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.5;
}
.snapshots-header-desc strong {
  color: var(--primary-color);
}
.snapshots-chart-container {
  margin: 2rem 0;
  padding: 1.5rem;
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  height: 400px;
}
.snapshots-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.snapshot-row {
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  padding: 1.25rem 1.5rem;
  cursor: pointer;
  transition: all 0.3s ease;
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 2rem;
  align-items: center;
  text-align: left;
}
.snapshot-row:hover:not(:disabled) {
  border-color: var(--primary-color);
  background: var(--bg-tertiary);
  transform: translateX(4px);
  box-shadow: var(--shadow-md);
}
.snapshot-row:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.snapshot-date-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}
.snapshot-date {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 1rem;
}
.snapshot-click-hint {
  font-size: 0.8rem;
  color: var(--primary-color);
  opacity: 0.9;
}
.snapshot-metrics-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
  align-items: center;
}
.snapshot-metric-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.metric-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}
.metric-content {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
}
.metric-value-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.metric-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}
.metric-diff {
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 0.25rem;
  line-height: 1.2;
}
.metric-diff.positive {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
}
.metric-diff.negative {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}
.metric-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.snapshot-files {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.snapshot-file {
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-family: 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (max-width: 768px) {
  .snapshot-row {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  .snapshot-metrics-row {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
</style>
