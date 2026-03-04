<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Doughnut } from 'vue-chartjs'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js'
import {
  fetchProposalsFromGovernor,
  fetchVoteBreakdownByProposal,
  fetchCanceledProposalIds,
  type ProposalSummary,
  type VoteBreakdown,
} from '@/utils/governanceClient'

ChartJS.register(Title, Tooltip, Legend, ArcElement)

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const proposalId = computed(() => String(route.params.proposalId ?? ''))

const proposal = ref<ProposalSummary | null>(null)
const breakdown = ref<VoteBreakdown | null>(null)
const isLoading = ref(true)
const notFound = ref(false)
const error = ref<string | null>(null)

function firstLine(text: string) {
  return text?.split('\n')[0]?.trim() || '—'
}

function getRipLabel(description: string): string {
  const match = description?.match(/\[?RIP[- ]?(\d+)\]?/i)
  const num = match ? match[1] : '?'
  return `[RIP-${num}]`
}

function formatBlockOrTime(value: bigint) {
  const n = Number(value)
  if (n >= 1e10) return new Date(n * 1000).toLocaleString()
  return n.toLocaleString()
}

function shortAddress(addr: string) {
  if (!addr || addr.length < 10) return addr || '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Affiche le pouvoir de vote de façon compacte pour éviter le débordement (ex. 345.77 × 10²⁴). */
function formatPower(value: bigint): string {
  const n = Number(value)
  if (n >= 1e27) return (n / 1e27).toFixed(2) + ' × 10²⁷'
  if (n >= 1e24) return (n / 1e24).toFixed(2) + ' × 10²⁴'
  if (n >= 1e21) return (n / 1e21).toFixed(2) + ' × 10²¹'
  if (n >= 1e18) return (n / 1e18).toFixed(2) + ' × 10¹⁸'
  if (n >= 1e15) return (n / 1e15).toFixed(2) + ' × 10¹⁵'
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}

onMounted(async () => {
  const id = proposalId.value
  if (!id) {
    notFound.value = true
    isLoading.value = false
    return
  }

  const state = history.state as { proposal?: ProposalSummary; breakdown?: VoteBreakdown } | undefined
  if (state?.proposal && state.proposal.proposalId === id && state?.breakdown) {
    proposal.value = state.proposal
    breakdown.value = state.breakdown
    isLoading.value = false
    return
  }

  isLoading.value = true
  error.value = null
  notFound.value = false
  try {
    const [proposalsList, breakdownMap, canceledIds] = await Promise.all([
      fetchProposalsFromGovernor(),
      fetchVoteBreakdownByProposal(),
      fetchCanceledProposalIds(),
    ])
    if (canceledIds.has(id)) {
      notFound.value = true
      proposal.value = null
      breakdown.value = null
    } else {
      const p = proposalsList.find((x) => x.proposalId === id) ?? null
      proposal.value = p
      breakdown.value = breakdownMap.get(id) ?? null
      if (!p) notFound.value = true
    }
  } catch (err) {
    console.error('Failed to load vote detail:', err)
    error.value = err instanceof Error ? err.message : t('voteDetail.fetchError')
  } finally {
    isLoading.value = false
  }
})

const ripLabel = computed(() =>
  proposal.value ? getRipLabel(proposal.value.description) : ''
)
const title = computed(() =>
  proposal.value ? firstLine(proposal.value.description) : ''
)

const totalVoters = computed(() => {
  const b = breakdown.value
  if (!b) return 0
  return b.byWallet.for + b.byWallet.against + b.byWallet.abstain
})

const totalPower = computed(() => {
  const b = breakdown.value
  if (!b) return 0n
  return b.byPower.for + b.byPower.against + b.byPower.abstain
})

const powerPct = computed(() => {
  const b = breakdown.value
  if (!b || totalPower.value === 0n) return { for: 0, against: 0, abstain: 0 }
  const t = totalPower.value
  return {
    for: Number((b.byPower.for * 10000n) / t) / 100,
    against: Number((b.byPower.against * 10000n) / t) / 100,
    abstain: Number((b.byPower.abstain * 10000n) / t) / 100,
  }
})

const walletPct = computed(() => {
  const b = breakdown.value
  if (!b || totalVoters.value === 0) return { for: 0, against: 0, abstain: 0 }
  const t = totalVoters.value
  return {
    for: (b.byWallet.for / t) * 100,
    against: (b.byWallet.against / t) * 100,
    abstain: (b.byWallet.abstain / t) * 100,
  }
})

const doughnutByPowerData = computed(() => {
  const b = breakdown.value
  if (!b || totalPower.value === 0n) return null
  return {
    labels: [t('vote.voteFor'), t('vote.voteAgainst'), t('vote.voteAbstain')],
    datasets: [
      {
        data: [Number(b.byPower.for), Number(b.byPower.against), Number(b.byPower.abstain)],
        backgroundColor: ['rgba(76, 175, 80, 0.85)', 'rgba(244, 67, 54, 0.85)', 'rgba(158, 158, 158, 0.85)'],
        borderColor: ['rgb(76, 175, 80)', 'rgb(244, 67, 54)', 'rgb(158, 158, 158)'],
        borderWidth: 1,
      },
    ],
  }
})

const doughnutByWalletData = computed(() => {
  const b = breakdown.value
  if (!b || totalVoters.value === 0) return null
  return {
    labels: [t('vote.voteFor'), t('vote.voteAgainst'), t('vote.voteAbstain')],
    datasets: [
      {
        data: [b.byWallet.for, b.byWallet.against, b.byWallet.abstain],
        backgroundColor: ['rgba(76, 175, 80, 0.85)', 'rgba(244, 67, 54, 0.85)', 'rgba(158, 158, 158, 0.85)'],
        borderColor: ['rgb(76, 175, 80)', 'rgb(244, 67, 54)', 'rgb(158, 158, 158)'],
        borderWidth: 1,
      },
    ],
  }
})

const doughnutOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' as const, labels: { color: '#ffffff', padding: 16 } },
    tooltip: {
      titleColor: '#ffffff',
      bodyColor: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      callbacks: {
        label: (ctx: { raw: number; label: string; dataset: { data: number[] } }) => {
          const total = ctx.dataset.data.reduce((a, b) => a + b, 0)
          const pct = total ? ((ctx.raw / total) * 100).toFixed(1) : '0'
          return `${ctx.label}: ${ctx.raw.toLocaleString()} (${pct}%)`
        },
      },
    },
  },
}))

function goBack() {
  router.push({ name: 'vote' })
}
</script>

<template>
  <div class="vote-detail-view">
    <nav class="vote-detail-back">
      <button type="button" class="back-btn" @click="goBack">
        ← {{ t('voteDetail.backToList') }}
      </button>
    </nav>

    <template v-if="isLoading">
      <p class="vote-detail-loading">{{ t('vote.loading') }}</p>
    </template>
    <template v-else-if="error">
      <p class="vote-detail-error">{{ error }}</p>
    </template>
    <template v-else-if="notFound || !proposal">
      <p class="vote-detail-not-found">{{ t('voteDetail.notFound') }}</p>
    </template>
    <template v-else>
      <header class="vote-detail-header">
        <span class="vote-detail-rip">{{ ripLabel }}</span>
        <h1 class="vote-detail-title">{{ title }}</h1>
        <div class="vote-detail-meta">
          <span class="vote-detail-proposer" :title="proposal.proposer">
            {{ t('voteDetail.proposer') }} {{ shortAddress(proposal.proposer) }}
          </span>
          <span class="vote-detail-dates">
            {{ t('vote.start') }} {{ formatBlockOrTime(proposal.voteStart) }} → {{ t('vote.end') }} {{ formatBlockOrTime(proposal.voteEnd) }}
          </span>
        </div>
      </header>

      <section class="vote-detail-stats">
        <h2 class="vote-detail-section-title">{{ t('voteDetail.keyFigures') }}</h2>
        <div class="vote-detail-cards">
          <div class="vote-detail-card">
            <span class="vote-detail-card-value">{{ totalVoters }}</span>
            <span class="vote-detail-card-label">{{ t('voteDetail.totalVoters') }}</span>
          </div>
          <div class="vote-detail-card">
            <span class="vote-detail-card-value">{{ formatPower(totalPower) }}</span>
            <span class="vote-detail-card-label">{{ t('voteDetail.totalPowerCast') }}</span>
          </div>
          <div class="vote-detail-card" v-if="breakdown">
            <span class="vote-detail-card-value">{{ breakdown.byWallet.for }} ({{ walletPct.for.toFixed(1) }}%)</span>
            <span class="vote-detail-card-label">{{ t('vote.voteFor') }}</span>
          </div>
          <div class="vote-detail-card" v-if="breakdown">
            <span class="vote-detail-card-value">{{ breakdown.byWallet.against }} ({{ walletPct.against.toFixed(1) }}%)</span>
            <span class="vote-detail-card-label">{{ t('vote.voteAgainst') }}</span>
          </div>
          <div class="vote-detail-card" v-if="breakdown">
            <span class="vote-detail-card-value">{{ breakdown.byWallet.abstain }} ({{ walletPct.abstain.toFixed(1) }}%)</span>
            <span class="vote-detail-card-label">{{ t('vote.voteAbstain') }}</span>
          </div>
        </div>
      </section>

      <section class="vote-detail-charts">
        <div class="vote-detail-chart-block" v-if="doughnutByPowerData">
          <p class="vote-detail-chart-explainer">{{ t('voteDetail.chartByPowerExplainer') }}</p>
          <div class="vote-detail-doughnut-wrap">
            <Doughnut :data="doughnutByPowerData" :options="doughnutOptions" />
          </div>
          <p class="vote-detail-chart-legend">
            {{ t('vote.voteFor') }}: {{ formatPower(breakdown!.byPower.for) }} ({{ powerPct.for.toFixed(1) }}%) ·
            {{ t('vote.voteAgainst') }}: {{ formatPower(breakdown!.byPower.against) }} ({{ powerPct.against.toFixed(1) }}%) ·
            {{ t('vote.voteAbstain') }}: {{ formatPower(breakdown!.byPower.abstain) }} ({{ powerPct.abstain.toFixed(1) }}%)
          </p>
        </div>
        <div class="vote-detail-chart-block" v-if="doughnutByWalletData">
          <p class="vote-detail-chart-explainer">{{ t('voteDetail.chartByWalletExplainer') }}</p>
          <div class="vote-detail-doughnut-wrap">
            <Doughnut :data="doughnutByWalletData" :options="doughnutOptions" />
          </div>
          <p class="vote-detail-chart-legend">
            {{ t('vote.voteFor') }}: {{ breakdown!.byWallet.for }} ({{ walletPct.for.toFixed(1) }}%) ·
            {{ t('vote.voteAgainst') }}: {{ breakdown!.byWallet.against }} ({{ walletPct.against.toFixed(1) }}%) ·
            {{ t('vote.voteAbstain') }}: {{ breakdown!.byWallet.abstain }} ({{ walletPct.abstain.toFixed(1) }}%)
          </p>
        </div>
      </section>

      <section v-if="proposal.description" class="vote-detail-description">
        <h2 class="vote-detail-section-title">{{ t('voteDetail.fullDescription') }}</h2>
        <pre class="vote-detail-description-text">{{ proposal.description }}</pre>
      </section>
    </template>
  </div>
</template>

<style scoped>
.vote-detail-view {
  padding: 2rem 0;
  animation: fadeIn 0.5s ease;
}
.vote-detail-back {
  margin-bottom: 1.5rem;
}
.back-btn {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
}
.back-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.vote-detail-loading,
.vote-detail-error,
.vote-detail-not-found {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
}
.vote-detail-error { color: var(--error-color); }
.vote-detail-header {
  margin-bottom: 2rem;
}
.vote-detail-rip {
  display: inline-block;
  font-weight: 700;
  color: var(--primary-color);
  margin-bottom: 0.5rem;
  font-size: 1rem;
}
.vote-detail-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.75rem 0;
  line-height: 1.3;
}
.vote-detail-meta {
  font-size: 0.9rem;
  color: var(--text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}
.vote-detail-section-title {
  font-size: 1.15rem;
  color: var(--text-primary);
  margin: 0 0 1rem 0;
}
.vote-detail-stats { margin-bottom: 2rem; }
.vote-detail-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 1rem;
}
.vote-detail-card {
  padding: 1rem;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  overflow: hidden;
}
.vote-detail-card-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  word-break: break-word;
  overflow-wrap: break-word;
  min-width: 0;
}
.vote-detail-card-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}
.vote-detail-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 2rem;
  margin-bottom: 2rem;
}
.vote-detail-chart-block {
  padding: 1.25rem;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
}
.vote-detail-chart-explainer {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin: 0 0 1rem 0;
  line-height: 1.4;
}
.vote-detail-doughnut-wrap {
  height: 260px;
  position: relative;
}
.vote-detail-chart-legend {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0.75rem 0 0 0;
  line-height: 1.4;
}
.vote-detail-description { margin-top: 2rem; }
.vote-detail-description-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0;
  padding: 1rem;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  max-height: 24rem;
  overflow-y: auto;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
