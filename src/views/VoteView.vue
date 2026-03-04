<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
} from 'chart.js'
import { fetchProposalsFromGovernor, fetchVoterCountByProposal, fetchCanceledProposalIds, type ProposalSummary } from '@/utils/governanceClient'
import { GOVERNANCE_CONTRACTS } from '@/constants/governance'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

const { t } = useI18n()
const proposals = ref<ProposalSummary[]>([])
const voterCountByProposalId = ref<Map<string, number>>(new Map())
const isLoading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  isLoading.value = true
  error.value = null
  try {
    const [proposalsList, voterCounts, canceledIds] = await Promise.all([
      fetchProposalsFromGovernor(),
      fetchVoterCountByProposal(),
      fetchCanceledProposalIds(),
    ])
    proposals.value = proposalsList.filter((p) => !canceledIds.has(p.proposalId))
    voterCountByProposalId.value = voterCounts
  } catch (err) {
    console.error('Failed to fetch proposals:', err)
    error.value = err instanceof Error ? err.message : t('vote.fetchError')
    proposals.value = []
  } finally {
    isLoading.value = false
  }
})

const barChartData = computed(() => {
  const list = proposals.value
  const counts = voterCountByProposalId.value
  if (!list.length) return null
  // Ordre chronologique : #1 à gauche, dernier vote à droite
  const reversed = [...list].reverse()
  const labels = reversed.map((p, i) => getRipLabel(p.description, i + 1))
  const fullNames = reversed.map((p) => firstLine(p.description) || '—')
  const data = reversed.map((p) => counts.get(p.proposalId) ?? 0)
  return {
    labels,
    datasets: [
      {
        label: t('vote.chartVotersLabel'),
        data,
        fullNames,
        backgroundColor: 'rgba(255, 140, 66, 0.7)',
        borderColor: 'rgb(255, 140, 66)',
        borderWidth: 1,
      },
    ],
  }
})

const barChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    title: {
      display: true,
      text: t('vote.chartTitle'),
      color: '#ffffff',
      font: { size: 16 },
    },
    tooltip: {
      titleColor: '#ffffff',
      bodyColor: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      callbacks: {
        title: (context: Array<{ dataIndex: number; dataset: { fullNames?: string[] } }>) => {
          const ctx = context[0]
          if (!ctx) return ''
          const fullNames = ctx.dataset?.fullNames
          return fullNames?.[ctx.dataIndex] ?? ''
        },
        label: (ctx: { raw: number }) => `${ctx.raw} ${t('vote.chartVotersLabel').toLowerCase()}`,
      },
    },
  },
  scales: {
    x: {
      title: {
        display: true,
        text: t('vote.chartXLabel'),
        color: '#ffffff',
      },
      grid: { display: false },
      ticks: { color: '#ffffff', maxRotation: 45 },
    },
    y: {
      beginAtZero: true,
      title: {
        display: true,
        text: t('vote.chartYLabel'),
        color: '#ffffff',
      },
      grid: { color: 'rgba(255, 255, 255, 0.2)' },
      ticks: { color: '#ffffff', stepSize: 1 },
    },
  },
}))

function shortAddress(addr: string) {
  if (!addr || addr.length < 10) return addr || '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function firstLine(text: string) {
  const line = text?.split('\n')[0]?.trim() || ''
  return line.length > 140 ? line.slice(0, 140) + '…' : line
}

/** Extrait le numéro RIP de la description (ex. "RIP-3", "[RIP-3]", "RIP 3") → "[RIP-3]" */
function getRipLabel(description: string, fallbackIndex: number): string {
  const match = description?.match(/\[?RIP[- ]?(\d+)\]?/i) ?? description?.match(/RIP[- ](\d+)/i)
  const num = match ? match[1] : String(fallbackIndex)
  return `[RIP-${num}]`
}

function formatBlockOrTime(value: bigint) {
  const n = Number(value)
  if (n >= 1e10) return new Date(n * 1000).toLocaleString()
  return n.toLocaleString()
}
</script>

<template>
  <div class="vote-view">
    <header class="vote-header">
      <h1 class="vote-title">{{ t('vote.title') }}</h1>
      <p class="vote-subtitle">{{ t('vote.subtitle') }}</p>
    </header>

    <section v-if="barChartData && !error" class="vote-chart-section">
      <div class="vote-chart-container">
        <Bar :data="barChartData" :options="barChartOptions" />
      </div>
    </section>

    <section class="contracts-section">
      <h2 class="section-title">{{ t('vote.contractsTitle') }}</h2>
      <p class="contract-address">
        <strong>Governor</strong>
        <code>{{ GOVERNANCE_CONTRACTS.Governor }}</code>
      </p>
    </section>

    <section class="proposals-section">
      <h2 class="section-title">{{ t('vote.proposalsListTitle') }}</h2>
      <p v-if="error" class="vote-error">{{ error }}</p>
      <div v-else-if="isLoading" class="vote-loading">{{ t('vote.loading') }}</div>
      <div v-else-if="proposals.length === 0" class="vote-empty">{{ t('vote.noProposals') }}</div>
      <ul v-else class="proposals-list">
        <li
          v-for="(p, index) in proposals"
          :key="p.proposalId"
          class="proposal-card"
        >
          <div class="proposal-header">
            <span class="proposal-index">#{{ proposals.length - index }}</span>
            <span class="proposal-id" :title="p.proposalId">ID {{ p.proposalId.length > 20 ? p.proposalId.slice(0, 16) + '…' : p.proposalId }}</span>
          </div>
          <p class="proposal-description">{{ firstLine(p.description) || '—' }}</p>
          <div class="proposal-meta">
            <span class="proposal-proposer" :title="p.proposer">{{ shortAddress(p.proposer) }}</span>
            <span class="proposal-dates">
              {{ t('vote.start') }} {{ formatBlockOrTime(p.voteStart) }} → {{ t('vote.end') }} {{ formatBlockOrTime(p.voteEnd) }}
            </span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.vote-view {
  padding: 2rem 0;
  animation: fadeIn 0.5s ease;
}
.vote-header {
  margin-bottom: 2rem;
}
.vote-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
}
.vote-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}
.vote-chart-section {
  margin-bottom: 2rem;
}
.vote-chart-container {
  height: 320px;
  padding: 1rem;
  background: var(--card-bg);
  border-radius: 0.75rem;
  border: 1px solid var(--border-color);
}
.section-title {
  font-size: 1.25rem;
  color: var(--text-primary);
  margin: 0 0 1rem 0;
}
.contracts-section {
  margin-bottom: 2.5rem;
  padding: 1.25rem;
  background: var(--card-bg);
  border-radius: 0.75rem;
  border: 1px solid var(--border-color);
}
.contract-address {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.contract-address code {
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  word-break: break-all;
  color: var(--text-primary);
}
.proposals-section {
  margin-top: 2rem;
}
.vote-loading,
.vote-empty,
.vote-error {
  padding: 1.5rem;
  text-align: center;
  color: var(--text-secondary);
  background: var(--card-bg);
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
}
.vote-error {
  color: var(--error-color);
}
.proposals-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.proposal-card {
  padding: 1.25rem;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  transition: border-color 0.2s;
}
.proposal-card:hover {
  border-color: var(--primary-color);
}
.proposal-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}
.proposal-index {
  font-weight: 700;
  color: var(--primary-color);
  font-size: 0.9rem;
}
.proposal-id {
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.proposal-description {
  font-size: 0.95rem;
  color: var(--text-primary);
  line-height: 1.4;
  margin: 0 0 0.75rem 0;
}
.proposal-meta {
  font-size: 0.8rem;
  color: var(--text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
}
.proposal-proposer {
  font-family: ui-monospace, monospace;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
