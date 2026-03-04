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
import { fetchProposalsFromGovernor, fetchVoteBreakdownByProposal, voterCountFromBreakdown, fetchCanceledProposalIds, type ProposalSummary, type VoteBreakdown } from '@/utils/governanceClient'
import { GOVERNANCE_CONTRACTS } from '@/constants/governance'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

const { t } = useI18n()
const proposals = ref<ProposalSummary[]>([])
const voteBreakdownByProposalId = ref<Map<string, VoteBreakdown>>(new Map())
const voterCountByProposalId = computed(() =>
  voterCountFromBreakdown(voteBreakdownByProposalId.value)
)
const isLoading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  isLoading.value = true
  error.value = null
  try {
    const [proposalsList, breakdown, canceledIds] = await Promise.all([
      fetchProposalsFromGovernor(),
      fetchVoteBreakdownByProposal(),
      fetchCanceledProposalIds(),
    ])
    proposals.value = proposalsList.filter((p) => !canceledIds.has(p.proposalId))
    voteBreakdownByProposalId.value = breakdown
  } catch (err) {
    console.error('Failed to fetch proposals:', err)
    error.value = err instanceof Error ? err.message : t('vote.fetchError')
    proposals.value = []
  } finally {
    isLoading.value = false
  }
})

const chartLabelsAndNames = computed(() => {
  const list = proposals.value
  if (!list.length) return { labels: [] as string[], fullNames: [] as string[] }
  const reversed = [...list].reverse()
  return {
    labels: reversed.map((p, i) => getRipLabel(p.description, i + 1)),
    fullNames: reversed.map((p) => firstLine(p.description) || '—'),
  }
})

const barChartData = computed(() => {
  const list = proposals.value
  const counts = voterCountByProposalId.value
  const { labels, fullNames } = chartLabelsAndNames.value
  if (!list.length || !labels.length) return null
  const reversed = [...list].reverse()
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

/** Répartition % Oui / Non / Abstention par pouvoir de vote (weight) */
const yesNoAbstainByPowerChartData = computed(() => {
  const list = proposals.value
  const breakdown = voteBreakdownByProposalId.value
  const { labels } = chartLabelsAndNames.value
  if (!list.length || !labels.length) return null
  const reversed = [...list].reverse()
  const forPct = reversed.map((p) => pctPower(p.proposalId, 'for', breakdown))
  const againstPct = reversed.map((p) => pctPower(p.proposalId, 'against', breakdown))
  const abstainPct = reversed.map((p) => pctPower(p.proposalId, 'abstain', breakdown))
  return {
    labels,
    datasets: [
      { label: t('vote.voteFor'), data: forPct, backgroundColor: 'rgba(76, 175, 80, 0.85)', borderColor: 'rgb(76, 175, 80)', borderWidth: 1 },
      { label: t('vote.voteAgainst'), data: againstPct, backgroundColor: 'rgba(244, 67, 54, 0.85)', borderColor: 'rgb(244, 67, 54)', borderWidth: 1 },
      { label: t('vote.voteAbstain'), data: abstainPct, backgroundColor: 'rgba(158, 158, 158, 0.85)', borderColor: 'rgb(158, 158, 158)', borderWidth: 1 },
    ],
  }
})

/** Répartition % Oui / Non / Abstention par nombre de wallets (1 wallet = 1 voix) */
const yesNoAbstainByWalletChartData = computed(() => {
  const list = proposals.value
  const breakdown = voteBreakdownByProposalId.value
  const { labels } = chartLabelsAndNames.value
  if (!list.length || !labels.length) return null
  const reversed = [...list].reverse()
  const forPct = reversed.map((p) => pctWallet(p.proposalId, 'for', breakdown))
  const againstPct = reversed.map((p) => pctWallet(p.proposalId, 'against', breakdown))
  const abstainPct = reversed.map((p) => pctWallet(p.proposalId, 'abstain', breakdown))
  return {
    labels,
    datasets: [
      { label: t('vote.voteFor'), data: forPct, backgroundColor: 'rgba(76, 175, 80, 0.85)', borderColor: 'rgb(76, 175, 80)', borderWidth: 1 },
      { label: t('vote.voteAgainst'), data: againstPct, backgroundColor: 'rgba(244, 67, 54, 0.85)', borderColor: 'rgb(244, 67, 54)', borderWidth: 1 },
      { label: t('vote.voteAbstain'), data: abstainPct, backgroundColor: 'rgba(158, 158, 158, 0.85)', borderColor: 'rgb(158, 158, 158)', borderWidth: 1 },
    ],
  }
})

function pctPower(
  proposalId: string,
  key: 'for' | 'against' | 'abstain',
  breakdown: Map<string, VoteBreakdown>
): number {
  const b = breakdown.get(proposalId)
  if (!b) return 0
  const total = b.byPower.for + b.byPower.against + b.byPower.abstain
  if (total === 0n) return 0
  const val = b.byPower[key]
  return Number((val * 10000n) / total) / 100
}

function pctWallet(
  proposalId: string,
  key: 'for' | 'against' | 'abstain',
  breakdown: Map<string, VoteBreakdown>
): number {
  const b = breakdown.get(proposalId)
  if (!b) return 0
  const total = b.byWallet.for + b.byWallet.against + b.byWallet.abstain
  if (total === 0) return 0
  return (b.byWallet[key] / total) * 100
}

function stackedBarChartOptions(titleKey: string) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#ffffff' } },
      title: {
        display: true,
        text: titleKey ? t(titleKey) : '',
        color: '#ffffff',
        font: { size: 14 },
      },
      tooltip: {
      titleColor: '#ffffff',
      bodyColor: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      callbacks: {
        label: (ctx: { raw: number; dataset: { label?: string } }) =>
          `${ctx.dataset?.label ?? ''}: ${Number(ctx.raw).toFixed(1)}%`,
      },
    },
  },
  scales: {
    x: {
      stacked: true,
      title: { display: true, text: t('vote.chartXLabel'), color: '#ffffff' },
      grid: { display: false },
      ticks: { color: '#ffffff', maxRotation: 45 },
    },
    y: {
      stacked: true,
      min: 0,
      max: 100,
      title: { display: true, text: '%', color: '#ffffff' },
      grid: { color: 'rgba(255, 255, 255, 0.2)' },
      ticks: { color: '#ffffff', callback: (v: number | string) => `${v}%` },
    },
  },
  }
}

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

    <section v-if="yesNoAbstainByPowerChartData && !error" class="vote-chart-section">
      <p class="vote-chart-explainer">{{ t('vote.chartByPowerExplainer') }}</p>
      <div class="vote-chart-container">
        <Bar :data="yesNoAbstainByPowerChartData" :options="stackedBarChartOptions('vote.chartByPowerTitle')" />
      </div>
    </section>

    <section v-if="yesNoAbstainByWalletChartData && !error" class="vote-chart-section">
      <p class="vote-chart-explainer">{{ t('vote.chartByWalletExplainer') }}</p>
      <div class="vote-chart-container">
        <Bar :data="yesNoAbstainByWalletChartData" :options="stackedBarChartOptions('vote.chartByWalletTitle')" />
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
          <RouterLink
            :to="{
              name: 'voteDetail',
              params: { proposalId: p.proposalId },
              state: {
                proposal: p,
                breakdown: voteBreakdownByProposalId.get(p.proposalId) ?? null,
              },
            }"
            class="proposal-card-link"
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
          </RouterLink>
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
.vote-chart-explainer {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0 0 0.75rem 0;
  line-height: 1.4;
  max-width: 60rem;
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
  transition: border-color 0.2s;
}
.proposal-card-link {
  display: block;
  padding: 1.25rem;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  color: inherit;
  text-decoration: none;
  transition: border-color 0.2s;
}
.proposal-card-link:hover {
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
