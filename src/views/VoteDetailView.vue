<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Doughnut, Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
} from 'chart.js'
import {
  fetchProposalsFromGovernor,
  fetchVoteBreakdownByProposal,
  fetchCanceledProposalIds,
  fetchProposalVoteCasts,
  getPastTotalSupply,
  fetchVoteStartTimestamps,
  type ProposalSummary,
  type ProposalVoteCast,
  type VoteBreakdown,
} from '@/utils/governanceClient'
import { loadSnapshotManifest, loadSnapshot, type SnapshotInfo } from '@/utils/snapshotLoader'

ChartJS.register(Title, Tooltip, Legend, ArcElement, LineElement, PointElement, CategoryScale, LinearScale)

function findClosestWalletCount(snapshots: SnapshotInfo[], voteTimestampSeconds: number): number | null {
  if (!snapshots.length || voteTimestampSeconds <= 0) return null
  const voteTime = voteTimestampSeconds * 1000
  let closest = snapshots[0]
  let minDiff = Math.abs(new Date(closest.dateFormatted).getTime() - voteTime)
  for (const s of snapshots) {
    const diff = Math.abs(new Date(s.dateFormatted).getTime() - voteTime)
    if (diff < minDiff) {
      minDiff = diff
      closest = s
    }
  }
  return closest.metrics?.walletCount ?? null
}

async function loadParticipationData(
  proposal: ProposalSummary,
  breakdown: VoteBreakdown
): Promise<{ powerPct: number; walletPct: number; totalSupply: bigint; walletCount: number } | null> {
  const powerCast = breakdown.byPower.for + breakdown.byPower.against + breakdown.byPower.abstain
  const totalVoters = breakdown.byWallet.for + breakdown.byWallet.against + breakdown.byWallet.abstain
  let totalSupply = 0n
  try {
    totalSupply = await getPastTotalSupply(proposal.voteStart)
  } catch {
    // token peut ne pas exposer getPastTotalSupply ou timepoint invalide
  }
  const [timestamps, manifest] = await Promise.all([
    fetchVoteStartTimestamps([proposal]),
    loadSnapshotManifest(),
  ])
  const ts = timestamps.get(proposal.proposalId) ?? 0
  const walletCount = findClosestWalletCount(manifest, ts) ?? 0
  const powerPct = totalSupply > 0n ? Number((powerCast * 10000n) / totalSupply) / 100 : 0
  const walletPct = walletCount > 0 ? (totalVoters * 100) / walletCount : 0
  return { powerPct, walletPct, totalSupply, walletCount }
}

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const proposalId = computed(() => String(route.params.proposalId ?? ''))

const proposal = ref<ProposalSummary | null>(null)
const breakdown = ref<VoteBreakdown | null>(null)
const participationData = ref<{
  powerPct: number
  walletPct: number
  totalSupply: bigint
  walletCount: number
} | null>(null)
const proposalVoteCasts = ref<ProposalVoteCast[]>([])
const allProposals = ref<ProposalSummary[]>([])
const comparisonProposalId = ref<string>('')
const snapshotPowerByAddress = ref<Map<string, number>>(new Map())
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

/** Formate un bigint en nombre lisible avec séparateurs de milliers. */
function formatBigIntWithGrouping(value: bigint): string {
  const negative = value < 0n
  const digits = (negative ? -value : value).toString()
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return negative ? `-${grouped}` : grouped
}

/** Formate une valeur compacte avec suffixes k, M, MM. */
function formatCompactNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2).replace(/\.?0+$/, '')} MM`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2).replace(/\.?0+$/, '')} M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2).replace(/\.?0+$/, '')} k`
  return value.toFixed(2).replace(/\.?0+$/, '')
}

/** Formate le pouvoir de vote en unité token (base 1e18). */
function formatPower(value: bigint): string {
  const decimals = 18n
  const base = 10n ** decimals
  const integerPart = value / base
  const fractionalRaw = value % base
  const fractionalStr = fractionalRaw.toString().padStart(Number(decimals), '0')
  const shortFraction = fractionalStr.slice(0, 2)
  const asNumber = Number(`${integerPart.toString()}.${shortFraction}`)

  if (Number.isFinite(asNumber)) return formatCompactNumber(asNumber)
  return formatBigIntWithGrouping(integerPart)
}

/** Retourne un libellé court quand la supply totale n'est pas disponible. */
function formatTotalSupply(value: bigint | null): string {
  if (value == null || value <= 0n) return '—'
  return formatPower(value)
}

/** Formate un pourcentage avec 2 décimales. */
function formatPct(value: number): string {
  return `${value.toFixed(2)}%`
}

/** Retourne le libellé de support (Pour/Contre/Abstention). */
function supportLabel(support: 'for' | 'against' | 'abstain'): string {
  if (support === 'for') return t('vote.voteFor')
  if (support === 'against') return t('vote.voteAgainst')
  return t('vote.voteAbstain')
}

/** Extrait un tableau d'entrees powerVoting depuis des formats snapshot heterogenes. */
function getPowerVotingEntries(raw: any): Array<{ address: string; powerVoting: number }> {
  const data = raw?.result?.powerVoting ?? raw?.powerVoting ?? raw
  if (!Array.isArray(data)) return []
  return data
    .map((row: any) => ({
      address: String(row?.address ?? '').toLowerCase(),
      powerVoting: Number(row?.powerVoting ?? 0),
    }))
    .filter((row) => row.address && Number.isFinite(row.powerVoting) && row.powerVoting > 0)
}

/** Charge le mapping adresse->powerVoting du snapshot le plus proche du vote courant. */
async function loadSnapshotPowerMapForProposal(targetProposal: ProposalSummary): Promise<Map<string, number>> {
  const [timestamps, manifest] = await Promise.all([
    fetchVoteStartTimestamps([targetProposal]),
    loadSnapshotManifest(),
  ])
  const ts = timestamps.get(targetProposal.proposalId) ?? 0
  if (!manifest.length || ts <= 0) return new Map()
  const voteTime = ts * 1000
  let closest = manifest[0]
  let minDiff = Math.abs(new Date(closest.dateFormatted).getTime() - voteTime)
  for (const s of manifest) {
    const diff = Math.abs(new Date(s.dateFormatted).getTime() - voteTime)
    if (diff < minDiff) {
      minDiff = diff
      closest = s
    }
  }
  const snap = await loadSnapshot(closest)
  const entries = getPowerVotingEntries(snap.powerVoting)
  const map = new Map<string, number>()
  for (const e of entries) map.set(e.address, e.powerVoting)
  return map
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
  } else {
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
    }
  }

  if (proposal.value && breakdown.value) {
    try {
      const [data, voteCasts] = await Promise.all([
        loadParticipationData(proposal.value, breakdown.value),
        fetchProposalVoteCasts(proposal.value.proposalId),
      ])
      participationData.value = data
      proposalVoteCasts.value = voteCasts
      comparisonProposalId.value = proposal.value.proposalId
    } catch (e) {
      console.warn('Participation data failed', e)
    }
  }

  try {
    const proposals = await fetchProposalsFromGovernor()
    allProposals.value = proposals
    if (proposal.value) {
      comparisonProposalId.value = comparisonProposalId.value || proposal.value.proposalId
      snapshotPowerByAddress.value = await loadSnapshotPowerMapForProposal(proposal.value)
    }
  } catch (e) {
    console.warn('Failed to load simulation data', e)
  }

  isLoading.value = false
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

const participationByPowerChartData = computed(() => {
  const p = participationData.value
  if (!p) return null
  const participated = Math.min(100, Math.max(0, p.powerPct))
  const notParticipated = 100 - participated
  return {
    labels: [t('voteDetail.participated'), t('voteDetail.notParticipated')],
    datasets: [
      {
        data: [participated, notParticipated],
        backgroundColor: ['rgba(76, 175, 80, 0.85)', 'rgba(158, 158, 158, 0.5)'],
        borderColor: ['rgb(76, 175, 80)', 'rgb(158, 158, 158)'],
        borderWidth: 1,
      },
    ],
  }
})

const participationByWalletChartData = computed(() => {
  const p = participationData.value
  if (!p) return null
  const participated = Math.min(100, Math.max(0, p.walletPct))
  const notParticipated = 100 - participated
  return {
    labels: [t('voteDetail.participated'), t('voteDetail.notParticipated')],
    datasets: [
      {
        data: [participated, notParticipated],
        backgroundColor: ['rgba(33, 150, 243, 0.85)', 'rgba(158, 158, 158, 0.5)'],
        borderColor: ['rgb(33, 150, 243)', 'rgb(158, 158, 158)'],
        borderWidth: 1,
      },
    ],
  }
})

const participationDoughnutOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' as const, labels: { color: '#ffffff', padding: 16 } },
    tooltip: {
      titleColor: '#ffffff',
      bodyColor: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      callbacks: {
        label: (ctx: { raw: number; label: string }) =>
          `${ctx.label}: ${Number(ctx.raw).toFixed(1)} %`,
      },
    },
  },
}))

const top20Voters = computed(() => {
  const totalCast = totalPower.value
  const totalSupply = participationData.value?.totalSupply ?? 0n
  return [...proposalVoteCasts.value]
    .sort((a, b) => (a.weight === b.weight ? 0 : a.weight > b.weight ? -1 : 1))
    .slice(0, 20)
    .map((v) => {
      const pctOfCast = totalCast > 0n ? Number((v.weight * 10000n) / totalCast) / 100 : 0
      const pctOfSupply = totalSupply > 0n ? Number((v.weight * 10000n) / totalSupply) / 100 : 0
      return { ...v, pctOfCast, pctOfSupply }
    })
})

const topVotersComparisonChartData = computed(() => {
  if (top20Voters.value.length === 0) return null
  return {
    labels: top20Voters.value.map((v) => shortAddress(v.voter)),
    datasets: [
      {
        label: t('voteDetail.voterPctOfCast'),
        data: top20Voters.value.map((v) => v.pctOfCast),
        borderColor: 'rgb(255, 140, 66)',
        backgroundColor: 'rgba(255, 140, 66, 0.25)',
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 3,
      },
      {
        label: t('voteDetail.voterPctOfSupply'),
        data: top20Voters.value.map((v) => v.pctOfSupply),
        borderColor: 'rgb(100, 181, 246)',
        backgroundColor: 'rgba(100, 181, 246, 0.25)',
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 3,
      },
    ],
  }
})

const topVotersComparisonChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: { color: '#ffffff', padding: 14 },
    },
    tooltip: {
      titleColor: '#ffffff',
      bodyColor: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      callbacks: {
        label: (ctx: { dataset: { label?: string }; raw: number }) =>
          `${ctx.dataset?.label ?? ''}: ${Number(ctx.raw).toFixed(2)}%`,
      },
    },
  },
  scales: {
    x: {
      ticks: { color: '#ffffff' },
      grid: { color: 'rgba(255, 255, 255, 0.1)' },
    },
    y: {
      ticks: {
        color: '#ffffff',
        callback: (v: number | string) => `${v}%`,
      },
      grid: { color: 'rgba(255, 255, 255, 0.15)' },
      beginAtZero: true,
    },
  },
}))

const comparisonProposalOptions = computed(() =>
  allProposals.value.map((p) => ({
    value: p.proposalId,
    label: `${getRipLabel(p.description)} ${firstLine(p.description)}`,
  }))
)

const selectedComparisonRipLabel = computed(() => {
  const selected = allProposals.value.find((p) => p.proposalId === comparisonProposalId.value)
  return selected ? getRipLabel(selected.description) : '—'
})

const simulatedComparisonChartData = computed(() => {
  const votes = proposalVoteCasts.value
  if (!votes.length) return null

  let originalFor = 0n
  let originalAgainst = 0n
  let originalAbstain = 0n
  let simulatedFor = 0
  let simulatedAgainst = 0
  let simulatedAbstain = 0

  for (const v of votes) {
    const simulatedPower = snapshotPowerByAddress.value.get(v.voter.toLowerCase()) ?? 0
    if (v.support === 'for') {
      originalFor += v.weight
      simulatedFor += simulatedPower
    } else if (v.support === 'against') {
      originalAgainst += v.weight
      simulatedAgainst += simulatedPower
    } else {
      originalAbstain += v.weight
      simulatedAbstain += simulatedPower
    }
  }

  const originalTotal = originalFor + originalAgainst + originalAbstain
  const simulatedTotal = simulatedFor + simulatedAgainst + simulatedAbstain
  return {
    labels: [t('vote.voteFor'), t('vote.voteAgainst'), t('vote.voteAbstain')],
    originalRaw: [originalFor, originalAgainst, originalAbstain],
    original: [
      originalTotal > 0n ? Number((originalFor * 10000n) / originalTotal) / 100 : 0,
      originalTotal > 0n ? Number((originalAgainst * 10000n) / originalTotal) / 100 : 0,
      originalTotal > 0n ? Number((originalAbstain * 10000n) / originalTotal) / 100 : 0,
    ],
    simulatedRaw: [simulatedFor, simulatedAgainst, simulatedAbstain],
    simulated: [
      simulatedTotal > 0 ? (simulatedFor / simulatedTotal) * 100 : 0,
      simulatedTotal > 0 ? (simulatedAgainst / simulatedTotal) * 100 : 0,
      simulatedTotal > 0 ? (simulatedAbstain / simulatedTotal) * 100 : 0,
    ],
  }
})

/** Genere une legende detaillee Oui/Non/Abstention avec valeur et pourcentage. */
function formatVoteLegend(values: [string, string, string], pcts: [number, number, number]): string {
  return `${t('vote.voteFor')}: ${values[0]} (${pcts[0].toFixed(1)}%) · ${t('vote.voteAgainst')}: ${values[1]} (${pcts[1].toFixed(1)}%) · ${t('vote.voteAbstain')}: ${values[2]} (${pcts[2].toFixed(1)}%)`
}

function formatVoteLegendHtml(values: [string, string, string], pcts: [number, number, number]): string {
  return `<span class="vote-legend-yes">${t('vote.voteFor')}: ${values[0]} (${pcts[0].toFixed(1)}%)</span> · <span class="vote-legend-no">${t('vote.voteAgainst')}: ${values[1]} (${pcts[1].toFixed(1)}%)</span> · <span class="vote-legend-abstain">${t('vote.voteAbstain')}: ${values[2]} (${pcts[2].toFixed(1)}%)</span>`
}

const simulationSummaryHtml = computed(() => {
  const data = simulatedComparisonChartData.value
  if (!data) return ''
  const originalLegend = formatVoteLegendHtml(
    [
      formatPower(data.originalRaw[0]),
      formatPower(data.originalRaw[1]),
      formatPower(data.originalRaw[2]),
    ],
    [data.original[0], data.original[1], data.original[2]]
  )
  const simulatedLegend = formatVoteLegendHtml(
    [
      formatCompactNumber(data.simulatedRaw[0]),
      formatCompactNumber(data.simulatedRaw[1]),
      formatCompactNumber(data.simulatedRaw[2]),
    ],
    [data.simulated[0], data.simulated[1], data.simulated[2]]
  )
  return `${t('voteDetail.simulationSummaryPrefix')} <strong>${ripLabel.value}</strong> (${t('voteDetail.simulationSummaryOriginalSnapshot')}) : ${originalLegend}. ${t('voteDetail.simulationSummaryComparisonPrefix')} <strong>${ripLabel.value}</strong>, ${t('voteDetail.simulationSummaryWithPowerFrom')} <strong>${selectedComparisonRipLabel.value}</strong>, ${t('voteDetail.simulationSummaryIs')} : ${simulatedLegend}.`
})

const simulationDiffRows = computed(() => {
  const data = simulatedComparisonChartData.value
  if (!data) return []
  const rows = [
    { key: 'yes', label: t('vote.voteFor'), colorClass: 'yes', diff: data.simulated[0] - data.original[0] },
    { key: 'no', label: t('vote.voteAgainst'), colorClass: 'no', diff: data.simulated[1] - data.original[1] },
    { key: 'abstain', label: t('vote.voteAbstain'), colorClass: 'abstain', diff: data.simulated[2] - data.original[2] },
  ]
  return rows.map((r) => ({
    ...r,
    widthPct: Math.min(100, Math.abs(r.diff) * 2), // 50 pts => 100% de largeur
    sign: r.diff > 0 ? '+' : '',
  }))
})

const simulatedComparisonDoughnutOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' as const, labels: { color: '#ffffff' } },
    tooltip: {
      titleColor: '#ffffff',
      bodyColor: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      callbacks: {
        label: (ctx: { dataset: { label?: string }; raw: number }) =>
          `${ctx.dataset?.label ?? ''}: ${Number(ctx.raw).toFixed(2)}%`,
      },
    },
  },
}))

watch(comparisonProposalId, async (id) => {
  if (!id) {
    snapshotPowerByAddress.value = new Map()
    return
  }
  try {
    const selected = allProposals.value.find((p) => p.proposalId === id)
    if (!selected) {
      snapshotPowerByAddress.value = new Map()
      return
    }
    snapshotPowerByAddress.value = await loadSnapshotPowerMapForProposal(selected)
  } catch (e) {
    console.warn('Failed to load comparison snapshot power map', e)
    snapshotPowerByAddress.value = new Map()
  }
})

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
          <div class="vote-detail-card">
            <span class="vote-detail-card-value">{{ formatTotalSupply(participationData?.totalSupply ?? null) }}</span>
            <span class="vote-detail-card-label">{{ t('voteDetail.totalPowerSupplyAtVote') }}</span>
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

      <section v-if="participationData" class="vote-detail-participation">
        <h2 class="vote-detail-section-title">{{ t('voteDetail.participationSectionTitle') }}</h2>
        <div class="vote-detail-participation-charts">
          <div class="vote-detail-chart-block" v-if="participationByPowerChartData">
            <p class="vote-detail-chart-explainer">{{ t('voteDetail.participationByPowerExplainer') }}</p>
            <div class="vote-detail-doughnut-wrap vote-detail-participation-doughnut">
              <Doughnut :data="participationByPowerChartData" :options="participationDoughnutOptions" />
            </div>
            <p class="vote-detail-chart-legend">
              {{ participationData.powerPct.toFixed(1) }} % {{ t('voteDetail.participated') }}
            </p>
          </div>
          <div class="vote-detail-chart-block" v-if="participationByWalletChartData">
            <p class="vote-detail-chart-explainer">{{ t('voteDetail.participationByWalletExplainer') }}</p>
            <div class="vote-detail-doughnut-wrap vote-detail-participation-doughnut">
              <Doughnut :data="participationByWalletChartData" :options="participationDoughnutOptions" />
            </div>
            <p class="vote-detail-chart-legend">
              {{ participationData.walletPct.toFixed(1) }} % {{ t('voteDetail.participated') }}
            </p>
          </div>
        </div>
      </section>

      <section class="vote-detail-simulation">
        <h2 class="vote-detail-section-title">{{ t('voteDetail.simulationSectionTitle') }}</h2>
        <p class="vote-detail-chart-explainer">{{ t('voteDetail.simulationSectionExplainer') }}</p>
        <div class="vote-detail-simulation-controls">
          <label class="vote-detail-simulation-label" for="comparison-proposal">
            {{ t('voteDetail.simulationSelectLabel') }}
          </label>
          <select id="comparison-proposal" v-model="comparisonProposalId" class="vote-detail-simulation-select">
            <option v-for="opt in comparisonProposalOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="vote-detail-chart-block" v-if="simulatedComparisonChartData">
          <div class="vote-detail-simulation-doughnuts">
            <div class="vote-detail-simulation-doughnut-item">
              <h3 class="vote-detail-subtitle">
                {{ t('voteDetail.simulationOriginalLabel') }} - {{ ripLabel }} {{ t('voteDetail.simulationOriginalSnapshotSuffix') }}
              </h3>
              <div class="vote-detail-doughnut-wrap vote-detail-simulation-chart-wrap">
                <Doughnut
                  :data="{
                    labels: simulatedComparisonChartData.labels,
                    datasets: [{
                      data: simulatedComparisonChartData.original,
                      backgroundColor: ['rgba(76, 175, 80, 0.85)', 'rgba(244, 67, 54, 0.85)', 'rgba(158, 158, 158, 0.85)'],
                      borderColor: ['rgb(76, 175, 80)', 'rgb(244, 67, 54)', 'rgb(158, 158, 158)'],
                      borderWidth: 1,
                    }],
                  }"
                  :options="simulatedComparisonDoughnutOptions"
                />
              </div>
              <p class="vote-detail-chart-legend">
                {{
                  formatVoteLegend(
                    [
                      formatPower(simulatedComparisonChartData.originalRaw[0]),
                      formatPower(simulatedComparisonChartData.originalRaw[1]),
                      formatPower(simulatedComparisonChartData.originalRaw[2]),
                    ],
                    [
                      simulatedComparisonChartData.original[0],
                      simulatedComparisonChartData.original[1],
                      simulatedComparisonChartData.original[2],
                    ]
                  )
                }}
              </p>
            </div>
            <div class="vote-detail-simulation-doughnut-item">
              <h3 class="vote-detail-subtitle">
                {{ t('voteDetail.simulationReweightedTitlePrefix') }} {{ ripLabel }}, {{ t('voteDetail.simulationReweightedTitleMiddle') }} {{ selectedComparisonRipLabel }}
              </h3>
              <div class="vote-detail-doughnut-wrap vote-detail-simulation-chart-wrap">
                <Doughnut
                  :data="{
                    labels: simulatedComparisonChartData.labels,
                    datasets: [{
                      data: simulatedComparisonChartData.simulated,
                      backgroundColor: ['rgba(76, 175, 80, 0.85)', 'rgba(244, 67, 54, 0.85)', 'rgba(158, 158, 158, 0.85)'],
                      borderColor: ['rgb(76, 175, 80)', 'rgb(244, 67, 54)', 'rgb(158, 158, 158)'],
                      borderWidth: 1,
                    }],
                  }"
                  :options="simulatedComparisonDoughnutOptions"
                />
              </div>
              <p class="vote-detail-chart-legend">
                {{
                  formatVoteLegend(
                    [
                      formatCompactNumber(simulatedComparisonChartData.simulatedRaw[0]),
                      formatCompactNumber(simulatedComparisonChartData.simulatedRaw[1]),
                      formatCompactNumber(simulatedComparisonChartData.simulatedRaw[2]),
                    ],
                    [
                      simulatedComparisonChartData.simulated[0],
                      simulatedComparisonChartData.simulated[1],
                      simulatedComparisonChartData.simulated[2],
                    ]
                  )
                }}
              </p>
            </div>
          </div>
          <p class="vote-detail-chart-explainer vote-detail-simulation-explainer">
            {{ t('voteDetail.simulationMethodExplainer') }}
          </p>
          <p class="vote-detail-chart-explainer vote-detail-simulation-summary" v-if="simulationSummaryHtml">
            <strong>{{ t('voteDetail.simulationReadTitle') }}:</strong>
            <span v-html="simulationSummaryHtml"></span>
          </p>
          <div class="vote-detail-simulation-diff" v-if="simulationDiffRows.length">
            <p class="vote-detail-chart-explainer"><strong>{{ t('voteDetail.simulationDiffTitle') }}:</strong> {{ t('voteDetail.simulationDiffExplainer') }}</p>
            <div v-for="row in simulationDiffRows" :key="row.key" class="vote-detail-simulation-diff-row">
              <div class="vote-detail-simulation-diff-label">{{ row.label }}</div>
              <div class="vote-detail-simulation-diff-track">
                <div class="vote-detail-simulation-diff-bar" :class="`is-${row.colorClass}`" :style="{ width: `${row.widthPct}%` }"></div>
              </div>
              <div class="vote-detail-simulation-diff-value">{{ row.sign }}{{ row.diff.toFixed(1) }} pts</div>
            </div>
          </div>
        </div>
      </section>

      <section class="vote-detail-voters">
        <h2 class="vote-detail-section-title">{{ t('voteDetail.topVotersTitle') }}</h2>
        <p class="vote-detail-chart-explainer">{{ t('voteDetail.topVotersExplainer') }}</p>
        <div class="vote-voters-comparison" v-if="topVotersComparisonChartData">
          <h3 class="vote-detail-subtitle">{{ t('voteDetail.topVotersChartTitle') }}</h3>
          <p class="vote-detail-chart-explainer">{{ t('voteDetail.topVotersChartExplainer') }}</p>
          <div class="vote-voters-chart-wrap">
            <Line :data="topVotersComparisonChartData" :options="topVotersComparisonChartOptions" />
          </div>
        </div>
        <div class="vote-voters-table-wrap">
          <table class="vote-voters-table">
            <thead>
              <tr>
                <th>{{ t('voteDetail.voterAddress') }}</th>
                <th>{{ t('voteDetail.voterChoice') }}</th>
                <th>{{ t('voteDetail.voterPctOfCast') }}</th>
                <th>{{ t('voteDetail.voterPctOfSupply') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in top20Voters" :key="`${v.voter}-${v.blockNumber}-${v.logIndex}`">
                <td class="vote-voters-address" :title="v.voter">{{ shortAddress(v.voter) }}</td>
                <td>{{ supportLabel(v.support) }}</td>
                <td>{{ formatPct(v.pctOfCast) }}</td>
                <td>{{ formatPct(v.pctOfSupply) }}</td>
              </tr>
              <tr v-if="top20Voters.length === 0">
                <td colspan="4">{{ t('voteDetail.noVoters') }}</td>
              </tr>
            </tbody>
          </table>
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
.vote-detail-participation {
  margin-bottom: 2rem;
}
.vote-detail-participation-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 2rem;
}
.vote-detail-participation-doughnut {
  height: 220px;
}
.vote-detail-simulation {
  margin-bottom: 2rem;
}
.vote-detail-simulation-controls {
  margin: 0 0 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.vote-detail-simulation-label {
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.vote-detail-simulation-select {
  background: var(--card-bg);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  padding: 0.55rem 0.7rem;
}
.vote-detail-simulation-chart-wrap {
  height: 240px;
}
.vote-detail-simulation-doughnuts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
}
.vote-detail-simulation-doughnut-item {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  padding: 0.75rem;
}
.vote-detail-simulation-explainer {
  margin-top: 0.9rem;
  font-size: 0.92rem;
  line-height: 1.5;
}
.vote-detail-simulation-summary {
  margin-top: 0.5rem;
  font-size: 0.92rem;
  line-height: 1.5;
}
.vote-detail-simulation-summary :deep(.vote-legend-yes) { color: rgb(76, 175, 80); font-weight: 600; }
.vote-detail-simulation-summary :deep(.vote-legend-no) { color: rgb(244, 67, 54); font-weight: 600; }
.vote-detail-simulation-summary :deep(.vote-legend-abstain) { color: rgb(158, 158, 158); font-weight: 600; }
.vote-detail-simulation-diff {
  margin-top: 0.75rem;
}
.vote-detail-simulation-diff-row {
  display: grid;
  grid-template-columns: 92px 1fr 86px;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
}
.vote-detail-simulation-diff-label {
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.vote-detail-simulation-diff-track {
  height: 8px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  overflow: hidden;
}
.vote-detail-simulation-diff-bar {
  height: 100%;
  border-radius: 999px;
}
.vote-detail-simulation-diff-bar.is-yes { background: rgba(76, 175, 80, 0.9); }
.vote-detail-simulation-diff-bar.is-no { background: rgba(244, 67, 54, 0.9); }
.vote-detail-simulation-diff-bar.is-abstain { background: rgba(158, 158, 158, 0.9); }
.vote-detail-simulation-diff-value {
  font-size: 0.85rem;
  color: var(--text-primary);
  text-align: right;
}
.vote-detail-voters {
  margin-bottom: 2rem;
}
.vote-voters-table-wrap {
  overflow-x: auto;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
}
.vote-voters-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 680px;
}
.vote-voters-table th,
.vote-voters-table td {
  text-align: left;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
  font-size: 0.9rem;
  color: var(--text-primary);
}
.vote-voters-table th {
  color: var(--text-secondary);
  font-weight: 600;
}
.vote-voters-address {
  font-family: ui-monospace, monospace;
}
.vote-voters-comparison {
  margin-top: 1rem;
  margin-bottom: 0.75rem;
  padding: 1rem;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
}
.vote-detail-subtitle {
  font-size: 1rem;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
}
.vote-voters-chart-wrap {
  height: 300px;
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
