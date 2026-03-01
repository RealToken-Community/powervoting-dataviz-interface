<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '@/stores/dataStore'
import { loadSnapshotManifest, loadSnapshot, type SnapshotInfo } from '@/utils/snapshotLoader'
import { Bar, Doughnut, Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  PointElement,
  LineElement,
} from 'chart.js'

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  PointElement,
  LineElement,
)

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const router = useRouter()
const { t } = useI18n()
const dataStore = useDataStore()
const expandedWallets = ref<Record<string, boolean>>({})
const expandedAddressResults = ref<Record<string, boolean>>({})
const availableSnapshots = ref<SnapshotInfo[]>([])
const selectedComparisonSnapshot = ref<string | null>(null)
const isLoadingComparison = ref(false)

// Address search functionality
const searchAddress = ref<string>('0xc6a82e72156a11a2e1634633af5e4517b451f0d9')
const addressSearchResults = ref<Array<{
  date: string
  dateFormatted: string
  isCurrent: boolean
  reg: number
  powerVoting: number
  found: boolean
  poolAnalysis?: {
    totalPools: number
    regInPools: number
    poolsInRange: number
    poolsOutOfRange: number
    regInRange: number
    regOutOfRange: number
    poolRegPercentage: number
    v2Pools: number
    v3Pools: number
    dexCount: number
  }
}>>([])
const isSearchingAddress = ref(false)

// Address details search
const addressSearchInput = ref<string>('')
const addressDetails = ref<{
  address: string
  totalREG: number
  walletREG: number
  poolREG: number
  powerVoting: number
  positions: Array<{
    dex: string
    poolType: string
    regAmount: number
    isActive: boolean
    counterpartAmount: number
    counterpartToken: string
  }>
} | null>(null)
const isSearchingAddressDetails = ref(false)
const addressSearchSectionExpanded = ref(true)

// Helper function to analyze pools for an entire snapshot
const analyzeSnapshotPools = (balancesArray: any[], powerVotingArray: any[]) => {
  let v2Pools = 0
  let v3Pools = 0
  let v3Active = 0
  let v3Inactive = 0
  const walletsWithPools = new Set<string>()
  let v3DataAvailable = false // Flag pour indiquer si les données V3 sont disponibles
  
  // Analyser toutes les positions de pools
  balancesArray.forEach((wallet: any) => {
    if (!wallet.sourceBalance) return
    
    let hasPools = false
    const networks = wallet.sourceBalance
    
    Object.entries(networks).forEach(([networkName, networkValue]: [string, any]) => {
      const dexs = networkValue?.dexs
      if (!dexs) return
      
      Object.entries(dexs).forEach(([dexName, rawPositions]: [string, any]) => {
        if (!Array.isArray(rawPositions)) return
        
        rawPositions.forEach((pos: any) => {
          const regAmount = parseFloat(String(pos.equivalentREG || '0'))
          if (regAmount <= 0) return
          
          hasPools = true
          // Détecter V3 : les pools V2 transformés ont tickLower: -887200 et tickUpper: 887200
          const tickLower = typeof pos.tickLower === 'number' ? pos.tickLower : parseFloat(String(pos.tickLower || 0))
          const tickUpper = typeof pos.tickUpper === 'number' ? pos.tickUpper : parseFloat(String(pos.tickUpper || 0))
          const isV2Transformed = tickLower === -887200 && tickUpper === 887200
          const hasTickLower = pos.tickLower !== undefined
          const hasTickUpper = pos.tickUpper !== undefined
          const isV3 = hasTickLower && hasTickUpper && !isV2Transformed
          
          // Si on trouve au moins une position avec tickLower/tickUpper, les données V3 sont disponibles
          if (hasTickLower || hasTickUpper) {
            v3DataAvailable = true
          }
          
          // Pour V3, vérifier isActive. Si non défini, considérer comme actif si c'est V2, inactif si V3
          // Note: pour les snapshots historiques, isActive peut ne pas être défini
          const isActive = pos.isActive !== undefined ? pos.isActive : (isV3 ? false : true)
          
          if (isV3) {
            v3Pools++
            if (isActive) {
              v3Active++
            } else {
              v3Inactive++
            }
          } else {
            v2Pools++
          }
        })
      })
    })
    
    if (hasPools) {
      walletsWithPools.add(wallet.walletAddress || '')
    }
  })
  
  // Calculer l'indice de concentration du pouvoir de vote pour plusieurs pourcentages
  const powerConcentration: Record<string, number> = {
    top10: 0,
    top15: 0,
    top20: 0,
    top25: 0,
    top50: 0,
  }
  
  if (powerVotingArray.length > 0) {
    const sortedPower = [...powerVotingArray]
      .map((p: any) => parseFloat(String(p.powerVoting || 0)))
      .sort((a, b) => b - a)
    
    const totalPower = sortedPower.reduce((sum, p) => sum + p, 0)
    if (totalPower > 0) {
      const percentages = [0.1, 0.15, 0.2, 0.25, 0.5]
      const keys = ['top10', 'top15', 'top20', 'top25', 'top50']
      
      percentages.forEach((percent, index) => {
        const topCount = Math.max(1, Math.floor(sortedPower.length * percent))
        const topPower = sortedPower.slice(0, topCount).reduce((sum, p) => sum + p, 0)
        powerConcentration[keys[index]] = (topPower / totalPower) * 100
      })
    }
  }
  
  return {
    v2Pools,
    v3Pools,
    v3Active,
    v3Inactive,
    walletsWithPools: walletsWithPools.size,
    powerConcentration,
    v3DataAvailable, // Indique si les données V3 sont disponibles dans ce snapshot
  }
}

// Helper function to analyze pool positions for a wallet
const analyzePoolPositions = (walletData: any) => {
  if (!walletData || !walletData.sourceBalance) {
    return null
  }

  const networks = walletData.sourceBalance
  const positions: Array<{
    equivalentREG: number
    isV3: boolean
    isActive?: boolean
  }> = []

  let totalRegInPools = 0
  let poolsInRange = 0
  let poolsOutOfRange = 0
  let regInRange = 0
  let regOutOfRange = 0
  let v2Pools = 0
  let v3Pools = 0
  const dexSet = new Set<string>()

  Object.entries(networks).forEach(([networkName, networkValue]: [string, any]) => {
    const dexs = networkValue?.dexs
    if (!dexs) return

    Object.entries(dexs).forEach(([dexName, rawPositions]: [string, any]) => {
      if (!Array.isArray(rawPositions)) return

      dexSet.add(`${networkName}-${dexName}`)

      rawPositions.forEach((pos: any) => {
        const regAmount = parseFloat(String(pos.equivalentREG || '0'))
        if (regAmount <= 0) return

        // Détecter V2 transformé vs vrai V3
        const tickLower = typeof pos.tickLower === 'number' ? pos.tickLower : parseFloat(String(pos.tickLower || 0))
        const tickUpper = typeof pos.tickUpper === 'number' ? pos.tickUpper : parseFloat(String(pos.tickUpper || 0))
        const isV2Transformed = tickLower === -887200 && tickUpper === 887200
        const isV3 = pos.tickLower !== undefined && pos.tickUpper !== undefined && !isV2Transformed
        const isActive = pos.isActive !== undefined ? pos.isActive : (isV3 ? false : true)

        totalRegInPools += regAmount

        if (isV3) {
          v3Pools++
          if (isActive) {
            poolsInRange++
            regInRange += regAmount
          } else {
            poolsOutOfRange++
            regOutOfRange += regAmount
          }
        } else {
          v2Pools++
          // V2 pools are considered "in range" by default (always active)
          poolsInRange++
          regInRange += regAmount
        }

        positions.push({
          equivalentREG: regAmount,
          isV3,
          isActive,
        })
      })
    })
  })

  const totalReg = parseFloat(String(walletData.totalBalanceREG || walletData.totalBalance || 0))
  const poolRegPercentage = totalReg > 0 ? (totalRegInPools / totalReg) * 100 : 0

  return {
    totalPools: positions.length,
    regInPools: totalRegInPools,
    poolsInRange,
    poolsOutOfRange,
    regInRange,
    regOutOfRange,
    poolRegPercentage,
    v2Pools,
    v3Pools,
    dexCount: dexSet.size,
  }
}

onMounted(async () => {
  if (dataStore.balances.length === 0 || dataStore.powerVoting.length === 0) {
    router.push('/')
    return
  }

  try {
    availableSnapshots.value = await loadSnapshotManifest()
    console.log('Available snapshots loaded:', availableSnapshots.value.length)
    // Load snapshot statistics
    await loadSnapshotStats()
    // Lancer automatiquement la recherche avec l'adresse par défaut
    if (searchAddress.value.trim()) {
      await searchAddressAcrossSnapshots()
    }
  } catch (err) {
    console.error('Failed to load snapshots:', err)
  }
})

const copiedAnchorId = ref<string | null>(null)
const copySectionLink = async (ev: MouseEvent, anchorId: string) => {
  ev.preventDefault()
  ev.stopPropagation()
  const urlSansHash = window.location.href.replace(/#.*$/, '')
  const urlAvecAncre = urlSansHash + '#' + anchorId
  const copieOk = () => {
    copiedAnchorId.value = anchorId
    setTimeout(() => { copiedAnchorId.value = null }, 2000)
  }
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(urlAvecAncre)
      copieOk()
      return
    }
  } catch {
    /* fallback ci-dessous */
  }
  const textarea = document.createElement('textarea')
  textarea.value = urlAvecAncre
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand('copy')
    copieOk()
  } catch {
    copiedAnchorId.value = null
  }
  document.body.removeChild(textarea)
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

const getSnapshotDiff = (snapshot: SnapshotInfo, allSnapshots: SnapshotInfo[]) => {
  if (!snapshot.metrics || allSnapshots.length === 0) return null

  // Find the index of current snapshot
  const currentIndex = allSnapshots.findIndex((s) => s.date === snapshot.date)
  if (currentIndex === -1) return null

  // Get the previous snapshot (next in the list, which is chronologically earlier)
  const previousSnapshot = allSnapshots[currentIndex + 1]
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

// --- Comparaison top holders Power Voting vs snapshot précédent ---
const previousSnapshotPowerData = ref<{
  sortedByPower: Array<{ address: string; power: number }>
  totalPower: number
  date: string
} | null>(null)
const isLoadingPreviousForTopHolders = ref(false)

function getPreviousSnapshotForComparison(): SnapshotInfo | null {
  const currentDate = dataStore.currentSnapshotDate
  if (!currentDate || availableSnapshots.value.length === 0) return null
  if (currentDate === 'Actuel') return availableSnapshots.value[0]
  const idx = availableSnapshots.value.findIndex((s) => s.date === currentDate)
  if (idx === -1 || idx >= availableSnapshots.value.length - 1) return null
  return availableSnapshots.value[idx + 1]
}

async function loadPreviousSnapshotForTopHolders() {
  const prev = getPreviousSnapshotForComparison()
  previousSnapshotPowerData.value = null
  if (!prev) return
  isLoadingPreviousForTopHolders.value = true
  try {
    const { powerVoting } = await loadSnapshot(prev)
    const raw = powerVoting?.result?.powerVoting || powerVoting
    const arr = Array.isArray(raw) ? raw : []
    const withPower = arr
      .map((p: any) => ({
        address: (p.address || '').toLowerCase(),
        power: parseFloat(String(p.powerVoting || 0)) || 0,
      }))
      .filter((x) => x.power > 0)
    const totalPower = withPower.reduce((s, x) => s + x.power, 0)
    const sortedByPower = [...withPower].sort((a, b) => b.power - a.power)
    previousSnapshotPowerData.value = { sortedByPower, totalPower, date: prev.date }
  } catch (e) {
    console.warn('Could not load previous snapshot for top holders comparison', e)
  } finally {
    isLoadingPreviousForTopHolders.value = false
  }
}

const top20HoldersComparison = computed(() => {
  if (dataStore.powerVoting.length === 0) return null
  const list = [...dataStore.powerVoting]
    .map((p) => ({
      address: (p.address || '').toLowerCase(),
      power: parseFloat(String(p.powerVoting || 0)) || 0,
      addressDisplay: p.address || '',
    }))
    .filter((x) => x.power > 0)
    .sort((a, b) => b.power - a.power)
    .slice(0, 20)
  const totalPower = dataStore.powerVoting.reduce(
    (s, p) => s + parseFloat(String(p.powerVoting || 0)) || 0,
    0,
  )
  if (totalPower <= 0) return null
  const prev = previousSnapshotPowerData.value
  const prevRankByAddress = new Map<string, number>()
  if (prev) {
    prev.sortedByPower.forEach((item, i) => {
      prevRankByAddress.set(item.address, i + 1)
    })
  }
  const prevTotal = prev?.totalPower ?? 0
  return list.map((item, i) => {
    const currentRank = i + 1
    const currentPct = (item.power / totalPower) * 100
    const prevRank = prev ? prevRankByAddress.get(item.address) ?? null : null
    const prevPct =
      prev && prevTotal > 0
        ? ((prev.sortedByPower.find((x) => x.address === item.address)?.power ?? 0) / prevTotal) * 100
        : null
    const placeChange = prevRank != null ? prevRank - currentRank : null
    const pctDiff = prevPct != null ? currentPct - prevPct : null
    return {
      rank: currentRank,
      address: item.addressDisplay,
      power: item.power,
      pctTotal: currentPct,
      placeChange,
      pctDiff,
    }
  })
})

watch(
  () => [dataStore.currentSnapshotDate, availableSnapshots.value.length] as const,
  () => {
    loadPreviousSnapshotForTopHolders()
  },
  { immediate: true },
)

// Ancien top 20 (snapshot précédent) : où sont-ils dans le classement actuel ?
const previousTop20CurrentRanks = computed(() => {
  const prev = previousSnapshotPowerData.value
  if (!prev || prev.sortedByPower.length === 0 || dataStore.powerVoting.length === 0) return null
  const currentSorted = [...dataStore.powerVoting]
    .map((p) => ({ address: (p.address || '').toLowerCase(), power: parseFloat(String(p.powerVoting || 0)) || 0 }))
    .filter((x) => x.power > 0)
    .sort((a, b) => b.power - a.power)
  const currentRankByAddress = new Map<string, number>()
  currentSorted.forEach((item, i) => {
    currentRankByAddress.set(item.address, i + 1)
  })
  const currentTotalPower = currentSorted.reduce((s, x) => s + x.power, 0)
  const previousTop20 = prev.sortedByPower.slice(0, 20)
  const prevTotal = prev.totalPower || 1
  return previousTop20.map((item, i) => {
    const previousRank = i + 1
    const currentRank = currentRankByAddress.get(item.address) ?? null
    const placeChange = currentRank != null ? currentRank - previousRank : null
    const addressDisplay = dataStore.powerVoting.find((p) => (p.address || '').toLowerCase() === item.address)?.address ?? item.address
    const prevPct = (item.power / prevTotal) * 100
    const currentPower = currentSorted.find((x) => x.address === item.address)?.power ?? 0
    const currentPct = currentTotalPower > 0 ? (currentPower / currentTotalPower) * 100 : 0
    const pctDiff = currentPct - prevPct
    return {
      previousRank,
      address: item.address,
      addressDisplay,
      currentRank,
      placeChange,
      pctDiff,
    }
  })
})

const CHART_GREEN = 'rgba(34, 197, 94, 0.85)'
const CHART_RED = 'rgba(239, 68, 68, 0.85)'

function shortAddress(addr: string): string {
  if (!addr || addr.length < 14) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

const top20RankEvolutionChartData = computed(() => {
  const list = top20HoldersComparison.value
  if (!list || list.length === 0) return null
  const labels = list.map((r) => `${r.rank}. ${shortAddress(r.address)}`)
  const data = list.map((r) => (r.placeChange != null ? r.placeChange : 0))
  const backgroundColor = list.map((r) => {
    if (r.placeChange == null || r.placeChange === 0) return 'rgba(148, 163, 184, 0.6)'
    return r.placeChange > 0 ? CHART_GREEN : CHART_RED
  })
  return {
    labels,
    datasets: [
      {
        label: t('analysis.placeChange'),
        data,
        backgroundColor,
        borderColor: list.map((r) => {
          if (r.placeChange == null || r.placeChange === 0) return 'rgba(148, 163, 184, 0.8)'
          return r.placeChange > 0 ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)'
        }),
        borderWidth: 1,
      },
    ],
  }
})

const top20PctEvolutionChartData = computed(() => {
  const list = top20HoldersComparison.value
  if (!list || list.length === 0) return null
  const labels = list.map((r) => `${r.rank}. ${shortAddress(r.address)}`)
  const data = list.map((r) => (r.pctDiff != null ? r.pctDiff : 0))
  const backgroundColor = list.map((r) => {
    if (r.pctDiff == null || r.pctDiff === 0) return 'rgba(148, 163, 184, 0.6)'
    return r.pctDiff > 0 ? CHART_GREEN : CHART_RED
  })
  return {
    labels,
    datasets: [
      {
        label: t('analysis.pctChange'),
        data,
        backgroundColor,
        borderColor: list.map((r) => {
          if (r.pctDiff == null || r.pctDiff === 0) return 'rgba(148, 163, 184, 0.8)'
          return r.pctDiff > 0 ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)'
        }),
        borderWidth: 1,
      },
    ],
  }
})

function topHoldersRankChartOptions() {
  return {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(30, 41, 59, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        borderColor: '#334155',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        ticks: { color: '#cbd5e1' },
        grid: { color: 'rgba(51, 65, 85, 0.3)' },
        title: {
          display: true,
          text: t('analysis.placeChange'),
          color: '#cbd5e1',
          font: { size: 12 },
        },
      },
      y: {
        ticks: { color: '#cbd5e1', font: { size: 11 }, maxRotation: 0 },
        grid: { color: 'rgba(51, 65, 85, 0.3)' },
      },
    },
  }
}

function topHoldersPctChartOptions() {
  return {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(30, 41, 59, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        borderColor: '#334155',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        ticks: { color: '#cbd5e1', callback: (value: number) => value + '%' },
        grid: { color: 'rgba(51, 65, 85, 0.3)' },
        title: {
          display: true,
          text: t('analysis.pctChange'),
          color: '#cbd5e1',
          font: { size: 12 },
        },
      },
      y: {
        ticks: { color: '#cbd5e1', font: { size: 11 }, maxRotation: 0 },
        grid: { color: 'rgba(51, 65, 85, 0.3)' },
      },
    },
  }
}

const isWalletExpanded = (address: string) => {
  return !!expandedWallets.value[address]
}

const toggleWalletPositions = (address: string) => {
  expandedWallets.value[address] = !isWalletExpanded(address)
}

// Calculer le multiplicateur estimé pour une position basé sur son type, son état et son DEX
const estimatePositionMultiplier = (position: any) => {
  // Pour V2, le multiplicateur peut varier selon le DEX
  // Pour V3 actif, le multiplicateur peut être plus élevé (2.0x à 4.0x+)
  // Pour V3 inactif, le multiplicateur est généralement 0 ou très faible
  
  if (position.poolType === 'v2') {
    // V2 pools : multiplicateur peut varier selon le DEX
    const dexName = (position.dex || '').toLowerCase()
    
    // Différents DEX peuvent avoir des multiplicateurs différents
    // Ces valeurs sont des estimations et peuvent être ajustées selon la configuration réelle
    if (dexName.includes('sushiswap')) {
      return 1.5 // Estimation pour Sushiswap V2
    } else if (dexName.includes('honeyswap')) {
      return 1.3 // Estimation pour Honeyswap V2
    } else if (dexName.includes('balancer')) {
      return 1.4 // Estimation pour Balancer V2
    } else {
      // DEX inconnu ou autre : multiplicateur par défaut
      return 1.5 // Estimation moyenne pour V2
    }
  } else if (position.poolType === 'v3') {
    // V3 pools : multiplicateur dépend de si la position est active
    if (position.isActive === true) {
      // Position V3 active : multiplicateur plus élevé
      // Le multiplicateur réel peut varier selon la position dans la range de prix
      return 2.5 // Estimation pour V3 actif
    } else {
      // Position V3 inactive : pas de boost ou très faible
      return 0.1 // Très faible multiplicateur pour V3 inactif
    }
  }
  
  return 1.0 // Par défaut
}

// Arrondir le ratio réel à la valeur théorique "ronde" la plus proche
// Valeurs théoriques : 0.1, 1.0, 1.3, 1.4, 1.5, 2.5
const roundToTheoreticalMultiplier = (realMultiplier: number): number => {
  const theoreticalValues = [0.1, 1.0, 1.3, 1.4, 1.5, 2.5]
  const maxTolerance = 0.5 // Tolérance maximale pour forcer l'utilisation d'une valeur théorique
  
  // Trouver la valeur théorique la plus proche
  let closestValue = theoreticalValues[0]
  let minDistance = Math.abs(realMultiplier - closestValue)
  
  for (const theoretical of theoreticalValues) {
    const distance = Math.abs(realMultiplier - theoretical)
    if (distance < minDistance) {
      minDistance = distance
      closestValue = theoretical
    }
  }
  
  // Si la distance est raisonnable (dans la tolérance maximale), utiliser la valeur théorique
  // Cela permet d'afficher des valeurs "rondes" même si le ratio réel est légèrement différent
  if (minDistance <= maxTolerance) {
    return closestValue
  }
  
  // Si le ratio réel est très différent de toutes les valeurs théoriques,
  // arrondir à 2 décimales pour afficher la valeur réelle
  return Math.round(realMultiplier * 100) / 100
}

// Calculer le multiplicateur global de chaque pool en agrégeant toutes les données
const globalPoolMultipliers = computed(() => {
  const poolsMap = new Map<string, { totalREG: number, totalPower: number }>()
  
  // Parcourir tous les profils pour agréger les données par pool
  dataStore.poolPowerCorrelation.forEach((profile) => {
    // Grouper les positions par poolAddress
    const profilePoolsMap = new Map<string, { positions: any[], totalREG: number, estimatedMultiplier: number }>()
    
    profile.positions.forEach((pos: any) => {
      const poolKey = pos.poolAddress || `${pos.dex}-${pos.poolType}`
      if (!profilePoolsMap.has(poolKey)) {
        profilePoolsMap.set(poolKey, { positions: [], totalREG: 0, estimatedMultiplier: 0 })
      }
      const pool = profilePoolsMap.get(poolKey)!
      pool.positions.push(pos)
      pool.totalREG += pos.regAmount
      if (pool.estimatedMultiplier === 0) {
        pool.estimatedMultiplier = estimatePositionMultiplier(pos)
      }
    })
    
    // Calculer le total des pouvoirs pondérés pour ce wallet
    let totalWeightedPower = 0
    profilePoolsMap.forEach((pool) => {
      totalWeightedPower += pool.totalREG * pool.estimatedMultiplier
    })
    
    // Distribuer le poolVotingShare entre les pools et agréger
    profilePoolsMap.forEach((pool, poolKey) => {
      if (!poolsMap.has(poolKey)) {
        poolsMap.set(poolKey, { totalREG: 0, totalPower: 0 })
      }
      const globalPool = poolsMap.get(poolKey)!
      globalPool.totalREG += pool.totalREG
      
      if (totalWeightedPower > 0) {
        const poolWeightedPower = pool.totalREG * pool.estimatedMultiplier
        const poolTotalPower = (profile.poolVotingShare * poolWeightedPower) / totalWeightedPower
        globalPool.totalPower += poolTotalPower
      }
    })
  })
  
  // Calculer le multiplicateur global pour chaque pool
  const multipliers = new Map<string, number>()
  poolsMap.forEach((pool, poolKey) => {
    const multiplier = pool.totalREG > 0 ? pool.totalPower / pool.totalREG : 0
    multipliers.set(poolKey, multiplier)
  })
  
  return multipliers
})

// Calculer le boost réel vs 1:1 pour un wallet
// Le boost réel est le ratio : Power (attribué pools) / Liquidité en pools
const getAveragePoolMultiplier = (profile: any) => {
  if (!profile || profile.poolLiquidityREG <= 0) {
    return 0
  }
  
  // Le boost réel est calculé comme le ratio du pouvoir attribué aux pools sur la liquidité
  // Cela reflète le multiplicateur réel moyen, pas une estimation
  if (profile.poolVotingShare && profile.poolVotingShare > 0) {
    return profile.poolVotingShare / profile.poolLiquidityREG
  }
  
  // Si poolVotingShare n'est pas disponible, utiliser le multiplicateur moyen pondéré estimé
  const poolsMap = new Map<string, { totalREG: number }>()
  
  profile.positions.forEach((pos: any) => {
    const poolKey = pos.poolAddress || `${pos.dex}-${pos.poolType}`
    if (!poolsMap.has(poolKey)) {
      poolsMap.set(poolKey, { totalREG: 0 })
    }
    const pool = poolsMap.get(poolKey)!
    pool.totalREG += pos.regAmount
  })
  
  // Calculer le multiplicateur moyen pondéré en utilisant les multiplicateurs globaux
  let totalWeightedPower = 0
  let totalREG = 0
  
  poolsMap.forEach((pool, poolKey) => {
    const globalMultiplier = globalPoolMultipliers.value.get(poolKey) || 0
    const estimatedMultiplier = globalMultiplier > 0 
      ? globalMultiplier 
      : estimatePositionMultiplier(profile.positions.find((p: any) => (p.poolAddress || `${p.dex}-${p.poolType}`) === poolKey))
    
    totalWeightedPower += pool.totalREG * estimatedMultiplier
    totalREG += pool.totalREG
  })
  
  return totalREG > 0 ? totalWeightedPower / totalREG : 0
}

// Calculer le pouvoir de vote et le multiplicateur pour chaque position
// Le multiplicateur affiché est calculé à partir du pouvoir réel si disponible, sinon estimation
// Le pouvoir est calculé en distribuant le poolVotingShare proportionnellement
const getPositionPowerAndMultiplier = (position: any, profile: any) => {
  if (!profile || profile.poolLiquidityREG <= 0 || profile.poolVotingShare <= 0) {
    return { power: 0, multiplier: 0 }
  }
  
  const poolKey = position.poolAddress || `${position.dex}-${position.poolType}`
  
  // Grouper les positions par poolAddress pour ce wallet
  const poolsMap = new Map<string, { positions: any[], totalREG: number }>()
  
  profile.positions.forEach((pos: any) => {
    const key = pos.poolAddress || `${pos.dex}-${pos.poolType}`
    if (!poolsMap.has(key)) {
      poolsMap.set(key, { positions: [], totalREG: 0 })
    }
    const pool = poolsMap.get(key)!
    pool.positions.push(pos)
    pool.totalREG += pos.regAmount
  })
  
  // Trouver la pool de cette position
  const positionPool = poolsMap.get(poolKey)
  
  if (!positionPool) {
    return { power: 0, multiplier: 0 }
  }
  
  // Distribuer le poolVotingShare proportionnellement à la liquidité de chaque pool
  const poolRatio = positionPool.totalREG / profile.poolLiquidityREG
  const poolTotalPower = profile.poolVotingShare * poolRatio
  
  // Distribuer le pouvoir de vote de la pool proportionnellement à la liquidité de cette position
  const positionRatio = position.regAmount / positionPool.totalREG
  const positionPower = poolTotalPower * positionRatio
  
  // Calculer le multiplicateur réel à partir du pouvoir réel
  // Le ratio positionPower / position.regAmount représente le ratio entre
  // le pouvoir de vote distribué et la liquidité boostée (equivalentREG)
  let poolMultiplier: number
  
  // Pour les positions V3 inactives, le multiplicateur devrait être 1.0
  // (selon inactiveBoost = 1 dans optionsModifiers.ts)
  if (position.poolType === 'v3' && position.isActive === false) {
    // Position V3 inactive : multiplicateur = 1.0
    poolMultiplier = 1.0
  } else if (position.regAmount > 0 && positionPower > 0) {
    const realMultiplier = positionPower / position.regAmount
    
    // Arrondir le ratio réel à la valeur théorique "ronde" la plus proche
    // Cela permet d'afficher des valeurs cohérentes (1.0, 1.3, 1.4, 1.5, 2.5, 0.1)
    // tout en respectant le ratio réel calculé
    poolMultiplier = roundToTheoreticalMultiplier(realMultiplier)
  } else if (position.regAmount > 0) {
    // Si pas de pouvoir mais de la liquidité, le multiplicateur est 0
    poolMultiplier = 0
  } else {
    // Si pas de liquidité, utiliser l'estimation théorique comme fallback
    poolMultiplier = estimatePositionMultiplier(position)
  }
  
  return {
    power: positionPower,
    multiplier: poolMultiplier
  }
}

// Compter les positions V2 et V3 pour un profil
const getPositionCounts = (profile: any) => {
  if (!profile || !profile.positions) {
    return { v2: 0, v3: 0 }
  }
  
  let v2Count = 0
  let v3Count = 0
  
  profile.positions.forEach((pos: any) => {
    if (pos.poolType === 'v2') {
      v2Count++
    } else if (pos.poolType === 'v3') {
      v3Count++
    }
  })
  
  return { v2: v2Count, v3: v3Count }
}

// Calculer le Power (attribué pools) pour V2 et V3 séparément
const getPowerByPoolType = (profile: any) => {
  if (!profile || !profile.positions || profile.poolLiquidityREG <= 0 || profile.poolVotingShare <= 0) {
    return { v2: 0, v3: 0 }
  }
  
  const poolsMap = new Map<string, { positions: any[], totalREG: number, poolType: string }>()
  
  profile.positions.forEach((pos: any) => {
    if (!pos) return // Sécurité si pos est null/undefined
    const key = pos.poolAddress || `${pos.dex}-${pos.poolType}`
    if (!poolsMap.has(key)) {
      poolsMap.set(key, { positions: [], totalREG: 0, poolType: pos.poolType })
    }
    const pool = poolsMap.get(key)!
    pool.positions.push(pos)
    pool.totalREG += parseFloat(pos.regAmount || pos.equivalentREG || '0')
  })
  
  let v2Power = 0
  let v3Power = 0
  
  poolsMap.forEach((pool, poolKey) => {
    const poolRatio = pool.totalREG / profile.poolLiquidityREG
    const poolTotalPower = profile.poolVotingShare * poolRatio
    
    if (pool.poolType === 'v2') {
      v2Power += poolTotalPower
    } else if (pool.poolType === 'v3') {
      v3Power += poolTotalPower
    }
  })
  
  return { v2: v2Power, v3: v3Power }
}

// Déterminer si une position V3 est active
const isPositionActive = (position: any) => {
  if (position.poolType !== 'v3') {
    return null // Pas applicable pour V2
  }
  return position.isActive === true
}

const toggleAddressResultDetails = (date: string) => {
  expandedAddressResults.value[date] = !expandedAddressResults.value[date]
}

const isAddressResultExpanded = (date: string) => {
  return !!expandedAddressResults.value[date]
}

// Données pour le graphique d'évolution de l'adresse
const addressEvolutionChartData = computed(() => {
  // Récupérer les couleurs CSS du thème
  const root = document.documentElement
  const getCSSVar = (varName: string, fallback: string) => {
    return getComputedStyle(root).getPropertyValue(varName).trim() || fallback
  }
  
  const primaryColor = getCSSVar('--primary-color', '#4a90e2')
  const secondaryColor = getCSSVar('--secondary-color', '#22c55e')
  
  // Convertir hex en rgba pour les backgrounds
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  
  const results = addressSearchResults.value.filter(r => r.found).sort((a, b) => {
    // Le snapshot actuel (uploadé) est toujours le plus récent (à droite)
    if (a.isCurrent && !b.isCurrent) return 1
    if (!a.isCurrent && b.isCurrent) return -1
    // Pour les snapshots historiques, trier par date croissante (ancien à gauche, récent à droite)
    // Mais ignorer le snapshot actuel qui a date='Actuel'
    if (a.date === 'Actuel' || b.date === 'Actuel') return 0
    
    // Parser les dates au format DD-MM-YYYY correctement
    const parseDate = (dateStr: string) => {
      const [day, month, year] = dateStr.split('-')
      return new Date(`${year}-${month}-${day}`).getTime()
    }
    
    const dateA = parseDate(a.date)
    const dateB = parseDate(b.date)
    
    // Vérifier que les dates sont valides
    if (isNaN(dateA) || isNaN(dateB)) {
      // Si une date est invalide, comparer les strings
      return a.date.localeCompare(b.date)
    }
    
    // Tri croissant : ancien à gauche, récent à droite
    return dateA - dateB
  })

  if (results.length === 0) {
    return {
      labels: [],
      datasets: []
    }
  }

  return {
    labels: results.map(r => r.dateFormatted || r.date),
    datasets: [
      {
        label: 'Power Voting',
        data: results.map(r => r.powerVoting),
        borderColor: primaryColor,
        backgroundColor: hexToRgba(primaryColor, 0.1),
        yAxisID: 'y',
        tension: 0.4,
        fill: false
      },
      {
        label: 'REG en Wallet',
        data: results.map(r => {
          const regInPools = r.poolAnalysis?.regInPools || 0
          return Math.max(0, r.reg - regInPools)
        }),
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        yAxisID: 'y',
        tension: 0.4,
        fill: false
      },
      {
        label: 'REG en Pools',
        data: results.map(r => r.poolAnalysis?.regInPools || 0),
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        yAxisID: 'y',
        tension: 0.4,
        fill: false
      }
    ]
  }
})

// Options pour le graphique d'évolution de l'adresse
const addressEvolutionChartOptions = computed(() => {
  // Récupérer les couleurs CSS du thème
  const root = document.documentElement
  const getCSSVar = (varName: string, fallback: string) => {
    return getComputedStyle(root).getPropertyValue(varName).trim() || fallback
  }
  
  const textPrimary = getCSSVar('--text-primary', '#ffffff')
  const textSecondary = getCSSVar('--text-secondary', '#a0a0a0')
  const borderColor = getCSSVar('--border-color', '#e5e7eb')
  
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          color: textPrimary,
          usePointStyle: true,
          padding: 15
        }
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: borderColor,
        borderWidth: 1,
        callbacks: {
          label: function(context: any) {
            let label = context.dataset.label || ''
            if (label) {
              label += ': '
            }
            label += formatNumber(context.parsed.y)
            return label
          }
        }
      }
    },
    scales: {
      x: {
        reverse: false,
        ticks: {
          color: textSecondary,
          maxRotation: 45,
          minRotation: 45
        },
        grid: {
          color: borderColor
        }
      },
      y: {
        type: 'linear' as const,
        display: true,
        position: 'left' as const,
        ticks: {
          color: textSecondary,
          callback: function(value: any) {
            return formatNumber(value)
          }
        },
        grid: {
          color: borderColor
        },
        title: {
          display: true,
          text: 'Power Voting / REG Total',
          color: textPrimary
        }
      }
    },
    interaction: {
      mode: 'nearest' as const,
      axis: 'x' as const,
      intersect: false
    }
  }
})

const copyAddress = async (address: string) => {
  try {
    await navigator.clipboard.writeText(address)
    // Optionnel: afficher un message de confirmation
    // Vous pouvez ajouter un toast notification ici si vous en avez un
  } catch (err) {
    console.error('Failed to copy address:', err)
    // Fallback pour les navigateurs qui ne supportent pas clipboard API
    const textArea = document.createElement('textarea')
    textArea.value = address
    textArea.style.position = 'fixed'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.select()
    try {
      document.execCommand('copy')
    } catch (fallbackErr) {
      console.error('Fallback copy failed:', fallbackErr)
    }
    document.body.removeChild(textArea)
  }
}

const formatAddress = (address: string) => {
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`
}

const formatSnapshotDate = (dateStr: string) => {
  const [day, month, year] = dateStr.split('-')
  return new Date(`${year}-${month}-${day}`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const loadComparisonSnapshot = async () => {
  if (!selectedComparisonSnapshot.value) return

  isLoadingComparison.value = true
  try {
    const snapshot = availableSnapshots.value.find((s) => s.date === selectedComparisonSnapshot.value)
    if (!snapshot) return

    const { balances, powerVoting } = await loadSnapshot(snapshot)
    dataStore.setComparisonSnapshot({
      balances,
      powerVoting,
      date: snapshot.date,
    })
  } catch (err) {
    console.error('Failed to load comparison snapshot:', err)
  } finally {
    isLoadingComparison.value = false
  }
}

const loadSnapshotData = async (snapshot: SnapshotInfo) => {
  isLoadingComparison.value = true
  try {
    const { balances, powerVoting } = await loadSnapshot(snapshot)

    dataStore.setBalancesData(balances)
    dataStore.setPowerVotingData(powerVoting)
    dataStore.setCurrentSnapshotDate(snapshot.date)

    // Reload page to refresh analysis
    window.location.reload()
  } catch (err) {
    console.error('Failed to load snapshot:', err)
  } finally {
    isLoadingComparison.value = false
  }
}

// Computed property to get all snapshots including current one
const allSnapshotsWithCurrent = computed(() => {
  const currentSnapshot: SnapshotInfo = {
    date: 'Actuel',
    dateFormatted: 'Actuel',
    balancesFile: 'Fichier actuel',
    powerVotingFile: 'Fichier actuel',
    metrics: dataStore.balances.length > 0 && dataStore.powerVoting.length > 0 ? {
      walletCount: dataStore.balances.length,
      totalREG: dataStore.balanceStats?.total || 0,
      totalPowerVoting: dataStore.powerVotingStats?.total || 0,
    } : undefined,
  }
  return [currentSnapshot, ...availableSnapshots.value]
})

const clearComparison = () => {
  dataStore.clearComparisonSnapshot()
  selectedComparisonSnapshot.value = null
}

// Snapshot statistics for comparison table
const snapshotStats = ref<Array<{
  date: string
  dateFormatted: string
  isCurrent: boolean
  wallets: number
  reg: number
  power: number
  walletsDiff?: number
  regDiff?: number
  powerDiff?: number
  poolMetrics?: {
    v2Pools: number
    v3Pools: number
    v3Active: number
    v3Inactive: number
    walletsWithPools: number
    powerConcentration: {
      top10: number
      top15: number
      top20: number
      top25: number
      top50: number
    }
    v3DataAvailable?: boolean // Indique si les données V3 sont disponibles
  }
}>>([])
const expandedSnapshots = ref<Set<string>>(new Set())

const toggleSnapshotDetails = (date: string) => {
  if (expandedSnapshots.value.has(date)) {
    expandedSnapshots.value.delete(date)
  } else {
    expandedSnapshots.value.add(date)
  }
}

const isSnapshotExpanded = (date: string) => {
  return expandedSnapshots.value.has(date)
}

const loadSnapshotStats = async () => {
  snapshotStats.value = []
  
  try {
    // Add current snapshot
    const currentWallets = dataStore.balances.length
    const currentReg = dataStore.balances.reduce((sum, b) => {
      return sum + parseFloat(String(b.totalBalanceREG || b.totalBalance || 0))
    }, 0)
    const currentPower = dataStore.powerVoting.reduce((sum, p) => {
      return sum + parseFloat(String(p.powerVoting || 0))
    }, 0)
    
    const currentPoolMetrics = analyzeSnapshotPools(dataStore.balances, dataStore.powerVoting)
    
    snapshotStats.value.push({
      date: 'Actuel',
      dateFormatted: 'Snapshot actuel (uploadé)',
      isCurrent: true,
      wallets: currentWallets,
      reg: currentReg,
      power: currentPower,
      poolMetrics: currentPoolMetrics,
    })
    
    // Load all historical snapshots in parallel for better performance
    console.log('Loading historical snapshots, count:', availableSnapshots.value.length)
    const snapshotPromises = availableSnapshots.value.map(async (snapshot) => {
      try {
        console.log('Loading snapshot:', snapshot.date)
        const { balances, powerVoting } = await loadSnapshot(snapshot)
        
        const balancesArray = balances.result?.balances || balances
        const powerVotingArray = powerVoting.result?.powerVoting || powerVoting
        
        const wallets = Array.isArray(balancesArray) ? balancesArray.length : 0
        const reg = Array.isArray(balancesArray)
          ? balancesArray.reduce((sum: number, b: any) => {
              return sum + parseFloat(String(b.totalBalanceREG || b.totalBalance || 0))
            }, 0)
          : 0
        const power = Array.isArray(powerVotingArray)
          ? powerVotingArray.reduce((sum: number, p: any) => {
              return sum + parseFloat(String(p.powerVoting || 0))
            }, 0)
          : 0
        
        const poolMetrics = analyzeSnapshotPools(
          Array.isArray(balancesArray) ? balancesArray : [],
          Array.isArray(powerVotingArray) ? powerVotingArray : []
        )
        
        console.log(`Successfully loaded snapshot ${snapshot.date}`)
        return {
          date: snapshot.date,
          dateFormatted: formatSnapshotDate(snapshot.date),
          isCurrent: false,
          wallets,
          reg,
          power,
          poolMetrics,
        }
      } catch (err) {
        console.error(`Failed to load snapshot ${snapshot.date}:`, err)
        return null // Return null for failed snapshots
      }
    })
    
    // Wait for all snapshots to load
    const results = await Promise.all(snapshotPromises)
    
    // Filter out failed snapshots and add to stats
    results.forEach((result) => {
      if (result) {
        snapshotStats.value.push(result)
      }
    })
    
    console.log(`Total snapshots loaded: ${snapshotStats.value.length}`)
    
    // Sort by date (current first, then newest first)
    snapshotStats.value.sort((a, b) => {
      if (a.isCurrent) return -1
      if (b.isCurrent) return 1
      const dateA = a.date.split('-').reverse().join('-')
      const dateB = b.date.split('-').reverse().join('-')
      return dateB.localeCompare(dateA)
    })
    
    // Calculate differences
    for (let i = 0; i < snapshotStats.value.length; i++) {
      if (i < snapshotStats.value.length - 1) {
        const current = snapshotStats.value[i]
        const previous = snapshotStats.value[i + 1]
        current.walletsDiff = current.wallets - previous.wallets
        current.regDiff = current.reg - previous.reg
        current.powerDiff = current.power - previous.power
      }
    }
  } catch (err) {
    console.error('Failed to load snapshot stats:', err)
  }
}

// Search address across all snapshots
// Fonction pour rechercher les détails d'une adresse
const searchAddressDetails = async () => {
  if (!addressSearchInput.value.trim()) {
    addressDetails.value = null
    return
  }

  const addressToSearch = addressSearchInput.value.trim().toLowerCase()
  isSearchingAddressDetails.value = true

  try {
    // Rechercher dans les données actuelles
    const balance = dataStore.balances.find(
      (b) => (b.walletAddress || '').toLowerCase() === addressToSearch
    )
    const power = dataStore.powerVoting.find(
      (p) => (p.address || '').toLowerCase() === addressToSearch
    )

    if (!balance && !power) {
      addressDetails.value = null
      return
    }

    const totalREG = balance ? parseFloat(String(balance.totalBalanceREG || balance.totalBalance || 0)) : 0
    const powerVoting = power ? parseFloat(String(power.powerVoting || 0)) : 0

    // Extraire les positions détaillées, groupées par pool (V2 par poolAddress, V3 par positionId)
    const positions: Array<{
      dex: string
      poolType: string
      regAmount: number
      isActive: boolean
      counterpartAmount: number
      counterpartToken: string
      poolAddress?: string
      positionId?: number | string | null
      tokens?: Array<{ tokenSymbol: string; tokenBalance: string }>
    }> = []

    if (balance && balance.sourceBalance) {
      const networks = balance.sourceBalance
      const byPool = new Map<string, Array<{
        pos: any
        dexName: string
        networkName: string
        regAmount: number
        isV3: boolean
        isActive: boolean
      }>>()

      Object.entries(networks).forEach(([networkName, networkValue]: [string, any]) => {
        const dexs = networkValue?.dexs
        if (!dexs) return

        Object.entries(dexs).forEach(([dexName, rawPositions]: [string, any]) => {
          if (!Array.isArray(rawPositions)) return

          rawPositions.forEach((pos: any) => {
            const regAmount = parseFloat(String(pos.equivalentREG || '0'))
            if (regAmount <= 0) return

            const tickLower = typeof pos.tickLower === 'number' ? pos.tickLower : parseFloat(String(pos.tickLower || 0))
            const tickUpper = typeof pos.tickUpper === 'number' ? pos.tickUpper : parseFloat(String(pos.tickUpper || 0))
            const isV2Transformed = tickLower === -887200 && tickUpper === 887200
            const isV3 = pos.tickLower !== undefined && pos.tickUpper !== undefined && !isV2Transformed
            const poolType = isV3 ? 'v3' : 'v2'
            const isActive = pos.isActive !== undefined ? pos.isActive : (isV3 ? false : true)

            const poolAddress = pos.poolAddress || 'unknown'
            const positionIdVal = pos.positionId !== undefined && pos.positionId !== null
              ? (typeof pos.positionId === 'string' ? parseInt(pos.positionId, 10) : Number(pos.positionId))
              : null
            const hasPositionId = positionIdVal !== null && !isNaN(positionIdVal) && positionIdVal !== 0
            const key = isV3 && hasPositionId ? `${poolAddress}-${positionIdVal}` : poolAddress

            if (!byPool.has(key)) byPool.set(key, [])
            byPool.get(key)!.push({ pos, dexName, networkName, regAmount, isV3, isActive })
          })
        })
      })

      byPool.forEach((group) => {
        const first = group[0]
        const regAmounts = group.map((g) => g.regAmount).filter((r) => r > 0)
        const regAmount = regAmounts.length > 0 ? Math.max(...regAmounts) : 0
        if (regAmount <= 0) return

        const tokenList = group.map((g) => ({
          tokenSymbol: g.pos.tokenSymbol || 'UNKNOWN',
          tokenBalance: String(g.pos.tokenBalance ?? '0'),
        }))
        let counterpartAmount = 0
        let counterpartToken = ''
        const other = tokenList.find((t) => t.tokenSymbol.toUpperCase() !== 'REG')
        if (other) {
          counterpartAmount = parseFloat(other.tokenBalance) || 0
          counterpartToken = other.tokenSymbol
        }

        positions.push({
          dex: first.dexName,
          poolType: first.isV3 ? 'v3' : 'v2',
          regAmount,
          isActive: first.isActive,
          counterpartAmount,
          counterpartToken,
          poolAddress: first.pos.poolAddress,
          positionId: first.pos.positionId,
          tokens: tokenList.length > 0 ? tokenList : undefined,
        })
      })
    }

    // REG en wallet : utiliser sourceBalance.*.walletBalance pour éviter le double comptage
    // (positions V3 ont 2 lignes par position → totalREG - sum(positions) peut être négatif)
    let walletREG = 0
    if (balance?.sourceBalance && typeof balance.sourceBalance === 'object') {
      Object.values(balance.sourceBalance).forEach((net: any) => {
        const wb = net?.walletBalance
        if (wb !== undefined && wb !== null && wb !== '') {
          walletREG += parseFloat(String(wb)) || 0
        }
      })
    }
    if (walletREG === 0 && balance) {
      // Fallback : totalREG - poolREG (comportement historique)
      const poolREGFromPositions = positions.reduce((sum, pos) => sum + pos.regAmount, 0)
      walletREG = Math.max(0, totalREG - poolREGFromPositions)
    }
    const poolREG = totalREG - walletREG

    // Reconstituer le Power Voting : séparation explicite REG direct (wallet) vs Équivalent REG (pools)
    const powerBreakdown: Array<{ label: string; regDirect: number; equivReg: number; powerContribution: number }> = []
    powerBreakdown.push({
      label: t('analysis.powerCalcWalletLine'),
      regDirect: walletREG,
      equivReg: 0,
      powerContribution: walletREG,
    })
    const totalPoolREG = positions.reduce((s, p) => s + p.regAmount, 0)
    const powerFromPools = Math.max(0, powerVoting - walletREG)
    positions.forEach((pos) => {
      const ratio = totalPoolREG > 0 ? pos.regAmount / totalPoolREG : 0
      powerBreakdown.push({
        label: `${pos.dex} ${(pos.poolType || 'v2').toUpperCase()}${pos.poolType === 'v3' ? (pos.isActive ? ' 🟢' : ' 🔴') : ''}`,
        regDirect: 0,
        equivReg: pos.regAmount,
        powerContribution: ratio * powerFromPools,
      })
    })

    addressDetails.value = {
      address: addressSearchInput.value.trim(),
      totalREG,
      walletREG: Math.max(0, walletREG),
      poolREG: Math.max(0, poolREG),
      powerVoting,
      positions,
      powerBreakdown,
    }
    await loadAddressEvolutionBySnapshot(addressToSearch)
  } catch (err) {
    console.error('Erreur lors de la recherche des détails:', err)
    addressDetails.value = null
    addressEvolutionBySnapshot.value = []
  } finally {
    isSearchingAddressDetails.value = false
  }
}

// Évolution de l'adresse recherchée sur tous les snapshots (rang + % + power)
const addressEvolutionBySnapshot = ref<Array<{
  date: string
  dateFormatted: string
  isCurrent: boolean
  rank: number | null
  rankChange: number | null
  pct: number
  pctChange: number | null
  power: number
}>>([])
const isLoadingAddressEvolution = ref(false)

const loadAddressEvolutionBySnapshot = async (addressLower: string) => {
  addressEvolutionBySnapshot.value = []
  isLoadingAddressEvolution.value = true
  try {
    const rows: Array<{ date: string; dateFormatted: string; isCurrent: boolean; rank: number | null; rankChange: number | null; pct: number; pctChange: number | null; power: number }> = []
    let prevRank: number | null = null
    let prevPct: number | null = null

    // Ligne snapshot actuel
    const sorted = [...dataStore.powerVoting]
      .map((p) => ({ address: (p.address || '').toLowerCase(), power: parseFloat(String(p.powerVoting || 0)) || 0 }))
      .filter((x) => x.power > 0)
      .sort((a, b) => b.power - a.power)
    const totalPower = sorted.reduce((s, x) => s + x.power, 0)
    const currentIdx = sorted.findIndex((x) => x.address === addressLower)
    const currentRank = currentIdx >= 0 ? currentIdx + 1 : null
    const rawCurrentPower = currentIdx >= 0 ? sorted[currentIdx].power : 0
    const currentPower = Number(rawCurrentPower) || 0
    const currentPct = totalPower > 0 ? (currentPower / totalPower) * 100 : 0
    rows.push({
      date: 'Actuel',
      dateFormatted: 'Snapshot actuel',
      isCurrent: true,
      rank: currentRank,
      rankChange: null,
      pct: currentPct,
      pctChange: null,
      power: currentPower,
    })
    prevRank = currentRank
    prevPct = currentPct

    // Lignes pour chaque snapshot historique (ordre: du plus récent au plus ancien)
    for (const snapshot of availableSnapshots.value) {
      const { powerVoting } = await loadSnapshot(snapshot)
      const raw = powerVoting?.result?.powerVoting || powerVoting
      const arr = Array.isArray(raw) ? raw : []
      const withPower = arr
        .map((p: any) => ({ address: (p.address || '').toLowerCase(), power: parseFloat(String(p.powerVoting || 0)) || 0 }))
        .filter((x: { address: string; power: number }) => x.power > 0)
      const snapTotal = withPower.reduce((s: number, x: { power: number }) => s + x.power, 0)
      const sortedSnap = [...withPower].sort((a, b) => b.power - a.power)
      const idx = sortedSnap.findIndex((x: { address: string }) => x.address === addressLower)
      const rank = idx >= 0 ? idx + 1 : null
      const power = idx >= 0 ? sortedSnap[idx].power : 0
      const pct = snapTotal > 0 ? (power / snapTotal) * 100 : 0
      // Évolution vs snapshot "suivant" (plus récent) : rank - prevRank > 0 = on était moins bien classé = places gagnées
      const rankChange = prevRank != null && rank != null ? rank - prevRank : null
      const pctChange = prevPct != null ? pct - prevPct : null
      rows.push({
        date: snapshot.date,
        dateFormatted: formatSnapshotDate(snapshot.date),
        isCurrent: false,
        rank,
        rankChange,
        pct,
        pctChange,
        power,
      })
      prevRank = rank
      prevPct = pct
    }
    addressEvolutionBySnapshot.value = rows
  } catch (e) {
    console.warn('Erreur chargement évolution par snapshot:', e)
    addressEvolutionBySnapshot.value = []
  } finally {
    isLoadingAddressEvolution.value = false
  }
}

const searchAddressAcrossSnapshots = async () => {
  if (!searchAddress.value.trim()) {
    addressSearchResults.value = []
    return
  }

  const addressToSearch = searchAddress.value.trim().toLowerCase()
  isSearchingAddress.value = true
  addressSearchResults.value = []

  try {
    // First, check current snapshot (uploaded)
    const currentBalance = dataStore.balances.find(
      (b) => (b.walletAddress || '').toLowerCase() === addressToSearch
    )
    const currentPower = dataStore.powerVoting.find(
      (p) => (p.address || '').toLowerCase() === addressToSearch
    )

    const currentPoolAnalysis = currentBalance ? analyzePoolPositions(currentBalance) : null

    addressSearchResults.value.push({
      date: 'Actuel',
      dateFormatted: 'Snapshot actuel (uploadé)',
      isCurrent: true,
      reg: currentBalance ? parseFloat(String(currentBalance.totalBalanceREG || currentBalance.totalBalance || 0)) : 0,
      powerVoting: currentPower ? parseFloat(String(currentPower.powerVoting || 0)) : 0,
      found: !!(currentBalance || currentPower),
      poolAnalysis: currentPoolAnalysis || undefined,
    })

    // Then check all historical snapshots
    for (const snapshot of availableSnapshots.value) {
      try {
        const { balances, powerVoting } = await loadSnapshot(snapshot)
        
        const balancesArray = balances.result?.balances || balances
        const powerVotingArray = powerVoting.result?.powerVoting || powerVoting
        
        const balanceData = Array.isArray(balancesArray)
          ? balancesArray.find((b: any) => (b.walletAddress || '').toLowerCase() === addressToSearch)
          : null
        
        const powerData = Array.isArray(powerVotingArray)
          ? powerVotingArray.find((p: any) => (p.address || '').toLowerCase() === addressToSearch)
          : null

        const poolAnalysis = balanceData ? analyzePoolPositions(balanceData) : null

        addressSearchResults.value.push({
          date: snapshot.date,
          dateFormatted: formatSnapshotDate(snapshot.date),
          isCurrent: false,
          reg: balanceData ? parseFloat(String(balanceData.totalBalanceREG || balanceData.totalBalance || 0)) : 0,
          powerVoting: powerData ? parseFloat(String(powerData.powerVoting || 0)) : 0,
          found: !!(balanceData || powerData),
          poolAnalysis: poolAnalysis || undefined,
        })
      } catch (err) {
        console.error(`Failed to load snapshot ${snapshot.date}:`, err)
        addressSearchResults.value.push({
          date: snapshot.date,
          dateFormatted: formatSnapshotDate(snapshot.date),
          isCurrent: false,
          reg: 0,
          powerVoting: 0,
          found: false,
        })
      }
    }

    // Sort by date (current first, then newest first)
    addressSearchResults.value.sort((a, b) => {
      if (a.isCurrent) return -1
      if (b.isCurrent) return 1
      // For historical snapshots, sort by date descending (newest first)
      const dateA = a.date.split('-').reverse().join('-') // Convert DD-MM-YYYY to YYYY-MM-DD
      const dateB = b.date.split('-').reverse().join('-')
      return dateB.localeCompare(dateA)
    })
  } catch (err) {
    console.error('Failed to search address:', err)
  } finally {
    isSearchingAddress.value = false
  }
}

// Chart data
const balanceDistributionChartData = computed(() => {
  const dist = dataStore.balanceDistribution
  if (!dist) return null

  return {
    labels: dist.map((b) => b.label),
    datasets: [
      {
        label: "Nombre d'adresses (wallets)",
        data: dist.map((b) => b.count),
        backgroundColor: [
          'rgba(99, 102, 241, 0.8)',
          'rgba(139, 92, 246, 0.8)',
          'rgba(236, 72, 153, 0.8)',
          'rgba(251, 146, 60, 0.8)',
          'rgba(34, 197, 94, 0.8)',
          'rgba(14, 165, 233, 0.8)',
        ],
        borderColor: [
          'rgb(99, 102, 241)',
          'rgb(139, 92, 246)',
          'rgb(236, 72, 153)',
          'rgb(251, 146, 60)',
          'rgb(34, 197, 94)',
          'rgb(14, 165, 233)',
        ],
        borderWidth: 2,
      },
    ],
  }
})

const powerVotingDistributionChartData = computed(() => {
  const dist = dataStore.powerVotingDistribution
  if (!dist) return null

  return {
    labels: dist.map((b) => b.label),
    datasets: [
      {
        label: "Nombre d'adresses",
        data: dist.map((b) => b.count),
        backgroundColor: [
          'rgba(236, 72, 153, 0.8)',
          'rgba(251, 146, 60, 0.8)',
          'rgba(34, 197, 94, 0.8)',
          'rgba(14, 165, 233, 0.8)',
          'rgba(99, 102, 241, 0.8)',
          'rgba(139, 92, 246, 0.8)',
        ],
        borderColor: [
          'rgb(236, 72, 153)',
          'rgb(251, 146, 60)',
          'rgb(34, 197, 94)',
          'rgb(14, 165, 233)',
          'rgb(99, 102, 241)',
          'rgb(139, 92, 246)',
        ],
        borderWidth: 2,
      },
    ],
  }

})

const poolsDistributionChartData = computed(() => {
  const analysis = dataStore.poolAnalysis
  if (!analysis) return null

  return {
    labels: ['Pools V2', 'Pools V3'],
    datasets: [
      {
        data: [analysis.v2.totalREG, analysis.v3.totalREG],
        backgroundColor: ['rgba(139, 92, 246, 0.8)', 'rgba(236, 72, 153, 0.8)'],
        borderColor: ['rgb(139, 92, 246)', 'rgb(236, 72, 153)'],
        borderWidth: 2
      }
    ]
  }
})

// Power concentration analysis
const powerConcentrationData = computed(() => {
  if (dataStore.powerVoting.length === 0) return null

  // Sort power voting by descending order
  const sortedPower = [...dataStore.powerVoting]
    .map(p => parseFloat(String(p.powerVoting || 0)))
    .filter(p => !isNaN(p) && p > 0)
    .sort((a, b) => b - a)

  if (sortedPower.length === 0) return null

  const totalPower = sortedPower.reduce((sum, p) => sum + p, 0)
  const totalAddresses = sortedPower.length

  // Calculate cumulative power for different percentiles
  const percentiles = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 95, 100]
  const concentration = percentiles.map(percent => {
    const count = Math.ceil((totalAddresses * percent) / 100)
    const topPower = sortedPower.slice(0, count).reduce((sum, p) => sum + p, 0)
    const powerPercentage = (topPower / totalPower) * 100
    
    return {
      percentile: percent,
      addressCount: count,
      powerHeld: topPower,
      powerPercentage: powerPercentage,
    }
  })

  return {
    totalPower,
    totalAddresses,
    concentration,
  }
})

// Gini coefficient calculation
const giniCoefficient = computed(() => {
  if (!powerConcentrationData.value) return null

  const sortedPower = [...dataStore.powerVoting]
    .map(p => parseFloat(String(p.powerVoting || 0)))
    .filter(p => !isNaN(p) && p > 0)
    .sort((a, b) => a - b) // Sort ascending for Gini

  if (sortedPower.length === 0) return null

  const n = sortedPower.length
  const totalPower = sortedPower.reduce((sum, p) => sum + p, 0)

  if (totalPower === 0) return 0

  let gini = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      gini += Math.abs(sortedPower[i] - sortedPower[j])
    }
  }

  gini = gini / (2 * n * n * (totalPower / n))
  return Math.round(gini * 10000) / 10000 // Round to 4 decimals
})

// Chart data for power concentration by percentile
const powerConcentrationChartData = computed(() => {
  if (!powerConcentrationData.value) return null

  const data = powerConcentrationData.value.concentration
  const labels = data.map(d => `Top ${d.percentile}%`)
  const percentages = data.map(d => d.powerPercentage)

  return {
    labels,
    datasets: [
      {
        label: '% de pouvoir détenu',
        data: percentages,
        backgroundColor: 'rgba(236, 72, 153, 0.8)',
        borderColor: 'rgb(236, 72, 153)',
        borderWidth: 2,
      },
    ],
  }
})

// Chart data for cumulative distribution (Lorenz curve)
const lorenzCurveData = computed(() => {
  if (!powerConcentrationData.value) return null

  const sortedPower = [...dataStore.powerVoting]
    .map(p => parseFloat(String(p.powerVoting || 0)))
    .filter(p => !isNaN(p) && p > 0)
    .sort((a, b) => b - a) // Descending

  if (sortedPower.length === 0) return null

  const totalPower = sortedPower.reduce((sum, p) => sum + p, 0)
  const totalAddresses = sortedPower.length

  // Create points for Lorenz curve (cumulative distribution)
  const points = []
  let cumulativePower = 0
  let cumulativeAddresses = 0

  // Add starting point (0, 0)
  points.push({ x: 0, y: 0 })

  // Calculate points for each percentile
  for (let i = 0; i < sortedPower.length; i++) {
    cumulativePower += sortedPower[i]
    cumulativeAddresses += 1

    const x = (cumulativeAddresses / totalAddresses) * 100 // % of addresses
    const y = (cumulativePower / totalPower) * 100 // % of power

    points.push({ x, y })
  }

  // Add ending point (100, 100)
  points.push({ x: 100, y: 100 })

  // Sample points for better performance (every 5%)
  const sampledPoints = []
  const sampleStep = Math.max(1, Math.floor(points.length / 20))
  for (let i = 0; i < points.length; i += sampleStep) {
    sampledPoints.push(points[i])
  }
  // Always include the last point
  if (sampledPoints[sampledPoints.length - 1]?.x !== 100) {
    sampledPoints.push(points[points.length - 1])
  }

  // Perfect equality line (diagonal) - sample points
  const equalityPoints = []
  for (let i = 0; i <= 100; i += 5) {
    equalityPoints.push(i)
  }

  return {
    labels: sampledPoints.map(p => `${Math.round(p.x)}%`),
    datasets: [
      {
        label: 'Ligne d\'égalité parfaite',
        data: equalityPoints,
        borderColor: 'rgba(255, 255, 255, 0.5)',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
      },
      {
        label: 'Distribution réelle',
        data: sampledPoints.map(p => p.y),
        borderColor: 'rgb(236, 72, 153)',
        backgroundColor: 'rgba(236, 72, 153, 0.1)',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
      },
    ],
  }
})

const dexsDistributionChartData = computed(() => {
  const analysis = dataStore.poolAnalysis
  if (!analysis) return null

  // Merge DEXs from V2 and V3
  const allDexs = new Set([
    ...Object.keys(analysis.v2.dexs),
    ...Object.keys(analysis.v3.dexs)
  ])

  const labels = Array.from(allDexs)
  const data = labels.map(dex => {
    return (analysis.v2.dexs[dex] || 0) + (analysis.v3.dexs[dex] || 0)
  })

  return {
    labels,
    datasets: [
      {
        label: 'Total REG',
        data,
        backgroundColor: [
          'rgba(34, 197, 94, 0.8)',
          'rgba(251, 146, 60, 0.8)',
          'rgba(14, 165, 233, 0.8)',
          'rgba(99, 102, 241, 0.8)'
        ],
        borderWidth: 0
      }
    ]
  }
})

// Computed pour récupérer les wallets affichés dans le graphique (réutilisable pour la table)
const chartWallets = computed(() => {
  const correlation = dataStore.poolPowerCorrelation
  if (!correlation || correlation.length === 0) return []

  // Filtrer pour ne garder que les entrées avec des pools et un powerVoting > 0
  const entriesWithPower = correlation.filter((entry) => entry.poolLiquidityREG > 0 && entry.powerVoting > 0)
  if (entriesWithPower.length === 0) return []

  // Séparer les wallets V2 et V3
  const v2Wallets = entriesWithPower.filter((entry) => {
    const hasV2 = entry.positions && entry.positions.some((pos: any) => pos.poolType === 'v2')
    return hasV2
  })

  const v3Wallets = entriesWithPower.filter((entry) => {
    const hasV3 = entry.positions && entry.positions.some((pos: any) => pos.poolType === 'v3')
    return hasV3
  })

  // Prendre les 30 plus gros de chaque catégorie, triés par liquidité décroissante
  const topV2 = v2Wallets
    .sort((a, b) => b.poolLiquidityREG - a.poolLiquidityREG)
    .slice(0, 30)

  const topV3 = v3Wallets
    .sort((a, b) => b.poolLiquidityREG - a.poolLiquidityREG)
    .slice(0, 30)

  // Combiner V2 et V3, triés par liquidité totale, limiter à 30 uniques
  const allWallets = [...topV2, ...topV3]
  // Dédupliquer par adresse et trier par liquidité
  const uniqueWallets = new Map<string, any>()
  allWallets.forEach((wallet) => {
    const addr = wallet.address.toLowerCase()
    if (!uniqueWallets.has(addr) || wallet.poolLiquidityREG > (uniqueWallets.get(addr)?.poolLiquidityREG || 0)) {
      uniqueWallets.set(addr, wallet)
    }
  })
  
  return Array.from(uniqueWallets.values())
    .sort((a, b) => b.poolLiquidityREG - a.poolLiquidityREG)
    .slice(0, 30)
})

const poolPowerChartData = computed(() => {
  const wallets = chartWallets.value
  if (wallets.length === 0) return null

  // Séparer les wallets V2 et V3 pour le graphique
  const v2Wallets = wallets.filter((entry) => {
    const hasV2 = entry.positions && entry.positions.some((pos: any) => pos.poolType === 'v2')
    return hasV2
  })

  const v3Wallets = wallets.filter((entry) => {
    const hasV3 = entry.positions && entry.positions.some((pos: any) => pos.poolType === 'v3')
    return hasV3
  })

  const topV2 = v2Wallets
  const topV3 = v3Wallets

  // Créer des labels et données séparés pour V2 et V3
  // Regrouper V2 d'abord, puis V3, pour que les courbes soient continues dans chaque section
  const v2Labels = topV2.map((entry) => formatAddress(entry.address))
  const v3Labels = topV3.map((entry) => formatAddress(entry.address))

  // Créer les données pour V2 (seulement pour les wallets V2)
  const v2RatioPools = topV2.map((entry) => {
    if (entry.poolLiquidityREG <= 0) return 0
    return entry.poolVotingShare / entry.poolLiquidityREG
  })

  const v2RatioTotal = topV2.map((entry) => {
    const totalREG = entry.walletDirectREG + entry.poolLiquidityREG
    if (totalREG <= 0) return 0
    return entry.powerVoting / totalREG
  })

  // Créer les données pour V3 (seulement pour les wallets V3)
  const v3RatioPools = topV3.map((entry) => {
    if (entry.poolLiquidityREG <= 0) return 0
    return entry.poolVotingShare / entry.poolLiquidityREG
  })

  const v3RatioTotal = topV3.map((entry) => {
    const totalREG = entry.walletDirectREG + entry.poolLiquidityREG
    if (totalREG <= 0) return 0
    return entry.powerVoting / totalREG
  })

  // Créer les baselines pour chaque catégorie
  const v2Baseline = v2Labels.map(() => 1)
  const v3Baseline = v3Labels.map(() => 1)
  
  // Combiner les labels : V2 d'abord, puis V3 (pour que les courbes soient continues)
  const allLabels = [...v2Labels, ...v3Labels]

  return {
    labels: allLabels, // V2 d'abord, puis V3
    datasets: [
      {
        label: 'Boost pools V2 (Power ÷ REG)',
        data: [...v2RatioPools, ...new Array(v3Labels.length).fill(null)], // V2 data + nulls pour V3
        borderColor: 'rgba(74, 144, 226, 1)',
        backgroundColor: 'rgba(74, 144, 226, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        spanGaps: false, // Ne pas connecter les points null - la courbe s'arrête après V2
      },
      {
        label: 'Multiplicateur global V2 (Power total ÷ REG total)',
        data: [...v2RatioTotal, ...new Array(v3Labels.length).fill(null)],
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderDash: [5, 5],
        spanGaps: false,
      },
      {
        label: 'Boost pools V3 (Power ÷ REG)',
        data: [...new Array(v2Labels.length).fill(null), ...v3RatioPools], // nulls pour V2 + V3 data
        borderColor: 'rgba(34, 197, 94, 1)',
        backgroundColor: 'rgba(34, 197, 94, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        spanGaps: false, // Ne pas connecter les points null - la courbe commence à V3
      },
      {
        label: 'Multiplicateur global V3 (Power total ÷ REG total)',
        data: [...new Array(v2Labels.length).fill(null), ...v3RatioTotal],
        borderColor: 'rgba(236, 72, 153, 1)',
        backgroundColor: 'rgba(236, 72, 153, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderDash: [5, 5],
        spanGaps: false,
      },
      {
        label: 'Référence 1:1',
        data: [...v2Baseline, ...v3Baseline],
        borderColor: 'rgba(148, 163, 184, 0.8)',
        borderDash: [8, 6],
        tension: 0,
        fill: false,
        pointRadius: 0,
      },
    ],
  }
})

const tooltipCallbacks = {
  label(context: any) {
    const datasetLabel = context.dataset?.label || ''
    const rawValue = Number(context.raw ?? 0)
    const isCountDataset = /wallet|adresse|nombre|count/i.test(datasetLabel)
    const formatter = isCountDataset ? formatInteger : formatNumber
    const formatted = formatter(rawValue)
    if (!datasetLabel) return formatted
    return `${datasetLabel}: ${formatted}`
  },
}

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      labels: {
        color: '#cbd5e1',
        font: {
          size: 12,
        },
      },
    },
    tooltip: {
      backgroundColor: 'rgba(30, 41, 59, 0.95)',
      titleColor: '#f8fafc',
      bodyColor: '#cbd5e1',
      borderColor: '#334155',
      borderWidth: 1,
      padding: 12,
      cornerRadius: 8,
      callbacks: tooltipCallbacks,
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      ticks: {
        color: '#cbd5e1',
      },
      grid: {
        color: 'rgba(51, 65, 85, 0.3)',
      },
    },
    x: {
      ticks: {
        color: '#cbd5e1',
      },
      grid: {
        color: 'rgba(51, 65, 85, 0.3)',
      },
    },
  },
}

const countChartOptions = {
  ...chartOptions,
  scales: {
    ...chartOptions.scales,
    x: {
      ...chartOptions.scales.x,
      title: {
        display: true,
        text: 'Tranches de montants (REG équivalents)',
        color: '#cbd5e1',
        font: {
          size: 14,
          weight: 'bold',
        },
      },
    },
    y: {
      ...chartOptions.scales.y,
      title: {
        display: true,
        text: "Nombre d'adresses (wallets)",
        color: '#cbd5e1',
        font: {
          size: 14,
          weight: 'bold',
        },
      },
      ticks: {
        ...chartOptions.scales.y.ticks,
        callback: (value: number) => formatInteger(Number(value)),
      },
    },
  },
}

// Chart options for power concentration
const powerConcentrationChartOptions = {
  ...chartOptions,
  scales: {
    ...chartOptions.scales,
    x: {
      ...chartOptions.scales.x,
      title: {
        display: true,
        text: 'Top X% des adresses',
        color: '#cbd5e1',
        font: {
          size: 14,
          weight: 'bold',
        },
      },
    },
    y: {
      ...chartOptions.scales.y,
      title: {
        display: true,
        text: '% du pouvoir de vote détenu',
        color: '#cbd5e1',
        font: {
          size: 14,
          weight: 'bold',
        },
      },
      ticks: {
        ...chartOptions.scales.y.ticks,
        callback: (value: number) => `${formatNumber(value)}%`,
      },
      max: 100,
    },
  },
}

const lorenzCurveChartOptions = {
  ...chartOptions,
  scales: {
    x: {
      ...chartOptions.scales.x,
      title: {
        display: true,
        text: '% cumulatif des adresses',
        color: '#cbd5e1',
        font: {
          size: 14,
          weight: 'bold',
        },
      },
      min: 0,
      max: 100,
      ticks: {
        ...chartOptions.scales.x.ticks,
        callback: (value: number) => `${value}%`,
      },
    },
    y: {
      ...chartOptions.scales.y,
      title: {
        display: true,
        text: '% cumulatif du pouvoir de vote',
        color: '#cbd5e1',
        font: {
          size: 14,
          weight: 'bold',
        },
      },
      min: 0,
      max: 100,
      ticks: {
        ...chartOptions.scales.y.ticks,
        callback: (value: number) => `${value}%`,
      },
    },
  },
}

const poolPowerChartOptions = {
  ...chartOptions,
  interaction: { mode: 'index', intersect: false },
  scales: {
    x: {
      ticks: {
        color: '#cbd5e1',
      },
      grid: {
        color: 'rgba(51, 65, 85, 0.3)',
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        color: '#cbd5e1',
      },
      grid: {
        color: 'rgba(51, 65, 85, 0.25)',
      },
    },
  },
}

// Graphique synthétique : Power Voting ÷ totalBalanceREG pour les wallets avec dépôts DEX
const dexBoostChartData = computed(() => {
  // Utiliser les mêmes wallets que le premier graphique
  const wallets = chartWallets.value
  if (wallets.length === 0) return null

  // Séparer les wallets V2 et V3 pour le graphique
  const v2Wallets = wallets.filter((entry) => {
    const hasV2 = entry.positions && entry.positions.some((pos: any) => pos.poolType === 'v2')
    return hasV2
  })

  const v3Wallets = wallets.filter((entry) => {
    const hasV3 = entry.positions && entry.positions.some((pos: any) => pos.poolType === 'v3')
    return hasV3
  })

  // Créer des labels séparés pour V2 et V3
  const v2Labels = v2Wallets.map((entry) => formatAddress(entry.address))
  const v3Labels = v3Wallets.map((entry) => formatAddress(entry.address))

  // Calculer le ratio Power Voting ÷ totalBalanceREG pour V2
  // Pour V2, on calcule l'impact des pools V2 par rapport au total du wallet (REG V2 + REG direct)
  const v2Ratios = v2Wallets.map((entry) => {
    if (!entry) return 1 // Sécurité si entry est null/undefined
    
    // Utiliser le powerVoting total et walletREG total pour avoir un ratio réaliste
    // Cela montre l'impact global du wallet avec des pools V2
    // et donne des ratios entre 1 et 2 pour la plupart des wallets (comme avant)
    const totalV2Power = entry.powerVoting || 0
    const totalV2REG = entry.walletREG || 0
    
    // Calculer le ratio V2
    if (totalV2REG <= 0) return 1 // Par défaut 1 si pas de REG
    const ratio = totalV2Power / totalV2REG
    
    // La courbe ne doit jamais descendre en dessous de 1
    return Math.max(1, ratio)
    
    // Debug: log pour le wallet problématique
    if (entry.address && entry.address.toLowerCase().includes('d9df1d931cfab59965c1a87e1e55131632357f0d')) {
      console.log('🔵 V2 Ratio Debug:', {
        address: entry.address,
        v2Power,
        v2REG,
        totalV2Power,
        totalV2REG,
        ratio,
        finalRatio: Math.max(1, ratio),
        powerVoting: entry.powerVoting,
        poolVotingShare: entry.poolVotingShare,
        walletDirectREG: entry.walletDirectREG
      })
    }
    
    // La courbe ne doit jamais descendre en dessous de 1
    return Math.max(1, ratio)
  })

  // Calculer le ratio Power Voting ÷ totalBalanceREG pour V3
  // Pour V3, on calcule le ratio en utilisant seulement les pools V3 + une partie proportionnelle du power direct
  const v3Ratios = v3Wallets.map((entry) => {
    if (!entry) return 1 // Sécurité si entry est null/undefined
    
    // Calculer le Power V3 (pools V3 uniquement)
    const powerByType = getPowerByPoolType(entry)
    const v3Power = powerByType?.v3 || 0
    
    // Calculer le REG V2 (pools V2 uniquement)
    let v2REG = 0
    if (entry.positions && entry.positions.length > 0) {
      entry.positions.forEach((pos: any) => {
        if (pos.poolType === 'v2') {
          v2REG += parseFloat(pos.regAmount || pos.equivalentREG || '0')
        }
      })
    }
    
    // Calculer le REG V3 (pools V3 uniquement)
    let v3REG = 0
    if (entry.positions && entry.positions.length > 0) {
      entry.positions.forEach((pos: any) => {
        if (pos.poolType === 'v3') {
          v3REG += parseFloat(pos.regAmount || pos.equivalentREG || '0')
        }
      })
    }
    
    // Calculer le Power direct (hors pools)
    const directPower = (entry.powerVoting || 0) - (entry.poolVotingShare || 0)
    
    // Pour V3, utiliser le total power direct (pas seulement proportionnel)
    // pour montrer l'impact global des pools V3 sur le wallet
    // Total Power pour V3 = Power V3 + Power direct total
    const totalV3Power = v3Power + directPower
    
    // Pour V3, utiliser le total REG du wallet (REG V3 + REG direct total)
    // pour montrer l'impact global des pools V3 sur le wallet
    const walletDirectREG = entry.walletDirectREG || 0
    
    // Total REG pour V3 = REG V3 + REG direct total (pas seulement proportionnel)
    // Cela permet de voir l'impact des pools V3 par rapport au total du wallet
    const totalV3REG = v3REG + walletDirectREG
    
    // Calculer le ratio V3
    if (totalV3REG <= 0) return 1 // Par défaut 1 si pas de REG
    const ratio = totalV3Power / totalV3REG
    
    // Debug: log pour le wallet problématique
    if (entry.address && entry.address.toLowerCase().includes('d9df1d931cfab59965c1a87e1e55131632357f0d')) {
      console.log('🟢 V3 Ratio Debug:', {
        address: entry.address,
        v3Power,
        v3REG,
        directPower,
        totalV3Power,
        walletDirectREG,
        totalV3REG,
        ratio,
        finalRatio: Math.max(1, ratio),
        powerVoting: entry.powerVoting,
        poolVotingShare: entry.poolVotingShare
      })
    }
    
    // La courbe ne doit jamais descendre en dessous de 1
    return Math.max(1, ratio)
  })

  // Calculer le ratio actif/inactif pour chaque wallet V3 et déterminer la couleur des points
  const v3PointColors = v3Wallets.map((entry, index) => {
    if (!entry) return 'rgba(34, 197, 94, 1)' // Sécurité si entry est null/undefined
    
    // Calculer le ratio Power Voting ÷ totalBalanceREG pour V3 (même calcul que v3Ratios)
    const powerByType = getPowerByPoolType(entry)
    const v3Power = powerByType?.v3 || 0
    
    // Calculer le REG V2 (pools V2 uniquement)
    let v2REG = 0
    if (entry.positions && entry.positions.length > 0) {
      entry.positions.forEach((pos: any) => {
        if (pos.poolType === 'v2') {
          v2REG += parseFloat(pos.regAmount || pos.equivalentREG || '0')
        }
      })
    }
    
    // Calculer le REG V3 (pools V3 uniquement)
    let v3REG = 0
    if (entry.positions && entry.positions.length > 0) {
      entry.positions.forEach((pos: any) => {
        if (pos.poolType === 'v3') {
          v3REG += parseFloat(pos.regAmount || pos.equivalentREG || '0')
        }
      })
    }
    
    // Calculer le Power direct (hors pools)
    const directPower = (entry.powerVoting || 0) - (entry.poolVotingShare || 0)
    
    // Pour V3, utiliser le total power direct et le total REG direct
    // pour montrer l'impact global des pools V3 sur le wallet
    const totalV3Power = v3Power + directPower
    const walletDirectREG = entry.walletDirectREG || 0
    const totalV3REG = v3REG + walletDirectREG
    const ratio = totalV3REG > 0 ? totalV3Power / totalV3REG : 1

    if (!entry.positions || entry.positions.length === 0) {
      // Pas de positions V3
      // Si ratio = 1, c'est une position inactive et loin du cours -> Rouge
      if (Math.abs(ratio - 1) < 0.001) {
        return 'rgba(239, 68, 68, 1)' // Rouge
      }
      // Si ratio > 1 sans positions V3, c'est anormal -> Jaune
      if (ratio > 1) {
        return 'rgba(234, 179, 8, 1)' // Jaune
      }
      // Sinon, point vert par défaut
      return 'rgba(34, 197, 94, 1)' // Vert
    }

    let totalRegInRange = 0
    let totalRegOutOfRange = 0

    entry.positions.forEach((pos: any) => {
      // Seulement les positions V3 (ignorer V2 pour la couleur)
      if (pos.poolType !== 'v3') return

      const regAmount = parseFloat(pos.regAmount || pos.equivalentREG || '0')
      if (regAmount <= 0) return

      // Vérifier si la position est active (in range)
      const isActive = pos.isActive !== undefined ? pos.isActive : false

      if (isActive) {
        totalRegInRange += regAmount
      } else {
        totalRegOutOfRange += regAmount
      }
    })

    const totalReg = totalRegInRange + totalRegOutOfRange
    if (totalReg <= 0) {
      // Pas de REG dans les pools V3 (mais peut-être du REG direct)
      // Si ratio = 1, c'est une position inactive et loin du cours -> Rouge
      if (Math.abs(ratio - 1) < 0.001) {
        return 'rgba(239, 68, 68, 1)' // Rouge
      }
      // Si ratio > 1 sans REG dans les pools V3, c'est anormal -> Jaune
      if (ratio > 1) {
        return 'rgba(234, 179, 8, 1)' // Jaune
      }
      // Sinon, point vert par défaut
      return 'rgba(34, 197, 94, 1)' // Vert
    }

    const ratioInRange = totalRegInRange / totalReg

    // Logique de couleur selon les nouvelles exigences :
    // 1. Tous les points avec ratio = 1 devraient être rouge - position inactive et loin du cours
    if (Math.abs(ratio - 1) < 0.001) {
      return 'rgba(239, 68, 68, 1)' // Rouge
    }

    // 2. Pour les points avec ratio > 1 :
    //    - Rouge si toutes les pools V3 sont out of range (range proche du cours mais inactif)
    //    - Sinon vert ou jaune selon l'état des pools
    if (ratio > 1) {
      if (ratioInRange <= 0) {
        // Ratio > 1 avec toutes les pools V3 out of range -> Rouge
        return 'rgba(239, 68, 68, 1)' // Rouge
      } else if (ratioInRange >= 1) {
        // Ratio > 1 avec toutes les pools V3 in range -> Vert
        return 'rgba(34, 197, 94, 1)' // Vert
      } else {
        // Ratio > 1 avec mixte (certaines in range, certaines out of range) -> Jaune
        return 'rgba(234, 179, 8, 1)' // Jaune
      }
    }

    // 3. Pour les points avec ratio < 1 (ne devrait pas arriver car on force >= 1, mais au cas où)
    // Si ratio < 1, c'est une anomalie, on met rouge
    return 'rgba(239, 68, 68, 1)' // Rouge
  })

  // Vérifier que les arrays ont la bonne longueur
  if (v2Ratios.length !== v2Labels.length || v3Ratios.length !== v3Labels.length || v3PointColors.length !== v3Labels.length) {
    console.error('Mismatch in array lengths:', {
      v2Ratios: v2Ratios.length,
      v2Labels: v2Labels.length,
      v3Ratios: v3Ratios.length,
      v3Labels: v3Labels.length,
      v3PointColors: v3PointColors.length
    })
    return null // Retourner null si les longueurs ne correspondent pas
  }

  // Filtrer les valeurs invalides (null, undefined, NaN)
  const safeV2Ratios = v2Ratios.map(r => (r != null && !isNaN(r)) ? r : 1)
  const safeV3Ratios = v3Ratios.map(r => (r != null && !isNaN(r)) ? r : 1)
  const safeV3PointColors = v3PointColors.map(c => c || 'rgba(34, 197, 94, 1)')

  // Créer les baselines pour chaque catégorie
  const v2Baseline = v2Labels.map(() => 1)
  const v3Baseline = v3Labels.map(() => 1)

  // Combiner les labels : V2 d'abord, puis V3
  const allLabels = [...v2Labels, ...v3Labels]

  // Créer les tableaux de couleurs pour les points V3 (nulls pour V2, couleurs pour V3)
  const v3PointBackgroundColors = [
    ...new Array(v2Labels.length).fill(null),
    ...safeV3PointColors
  ]
  const v3PointBorderColors = [
    ...new Array(v2Labels.length).fill(null),
    ...safeV3PointColors
  ]

  return {
    labels: allLabels, // V2 d'abord, puis V3
    datasets: [
      {
        label: 'Power Voting ÷ totalBalanceREG (V2)',
        data: [...safeV2Ratios, ...new Array(v3Labels.length).fill(null)], // V2 data + nulls pour V3
        borderColor: 'rgba(74, 144, 226, 1)', // Bleu pour V2
        backgroundColor: 'rgba(74, 144, 226, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        spanGaps: false, // Ne pas connecter les points null
      },
      {
        label: 'Power Voting ÷ totalBalanceREG (V3)',
        data: [...new Array(v2Labels.length).fill(null), ...safeV3Ratios], // nulls pour V2 + V3 data
        borderColor: 'rgba(34, 197, 94, 1)', // Vert pour V3
        backgroundColor: 'rgba(34, 197, 94, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 5, // Taille réduite pour les points
        pointHoverRadius: 7,
        pointBackgroundColor: v3PointBackgroundColors, // Couleurs personnalisées pour les points
        pointBorderColor: v3PointBorderColors,
        pointBorderWidth: 2,
        spanGaps: false, // Ne pas connecter les points null
      },
      {
        label: 'Référence 1:1',
        data: [...v2Baseline, ...v3Baseline],
        borderColor: 'rgba(148, 163, 184, 0.8)',
        borderDash: [8, 6],
        tension: 0,
        fill: false,
        pointRadius: 0,
      },
      // Datasets pour la légende des points colorés V3
      {
        label: '🟢 Pools V3 in range (actives)',
        data: [],
        borderColor: 'rgba(34, 197, 94, 1)',
        backgroundColor: 'rgba(34, 197, 94, 1)',
        pointRadius: 5,
        pointBorderWidth: 2,
        pointBorderColor: 'rgba(34, 197, 94, 1)',
        borderWidth: 0,
        hidden: false,
        showLine: false,
      },
      {
        label: '🔴 Pools V3 out of range (inactives)',
        data: [],
        borderColor: 'rgba(239, 68, 68, 1)',
        backgroundColor: 'rgba(239, 68, 68, 1)',
        pointRadius: 5,
        pointBorderWidth: 2,
        pointBorderColor: 'rgba(239, 68, 68, 1)',
        borderWidth: 0,
        hidden: false,
        showLine: false,
      },
      {
        label: '🟡 Pools V3 mixtes (actives + inactives)',
        data: [],
        borderColor: 'rgba(234, 179, 8, 1)',
        backgroundColor: 'rgba(234, 179, 8, 1)',
        pointRadius: 5,
        pointBorderWidth: 2,
        pointBorderColor: 'rgba(234, 179, 8, 1)',
        borderWidth: 0,
        hidden: false,
        showLine: false,
      },
    ],
  }
})

const dexBoostChartOptions = {
  ...chartOptions,
  interaction: { mode: 'index', intersect: false },
  scales: {
    x: {
      ticks: {
        color: '#cbd5e1',
        maxRotation: 45,
        minRotation: 45,
      },
      grid: {
        color: 'rgba(51, 65, 85, 0.3)',
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        color: '#cbd5e1',
      },
      grid: {
        color: 'rgba(51, 65, 85, 0.25)',
      },
      title: {
        display: true,
        text: 'Ratio Power ÷ REG',
        color: '#cbd5e1',
        font: {
          size: 14,
          weight: 'bold',
        },
      },
    },
  },
}

const powerBreakdownChartData = computed(() => {
  // Utiliser les mêmes wallets que le premier graphique
  const wallets = chartWallets.value
  if (wallets.length === 0) return null

  // Séparer les wallets V2 et V3 pour le graphique
  const v2Wallets = wallets.filter((entry) => {
    const hasV2 = entry.positions && entry.positions.some((pos: any) => pos.poolType === 'v2')
    return hasV2
  })

  const v3Wallets = wallets.filter((entry) => {
    const hasV3 = entry.positions && entry.positions.some((pos: any) => pos.poolType === 'v3')
    return hasV3
  })

  // Créer des labels séparés pour V2 et V3
  const v2Labels = v2Wallets.map((entry) => formatAddress(entry.address))
  const v3Labels = v3Wallets.map((entry) => formatAddress(entry.address))

  // Fonction helper pour calculer le power issu de l'apport REG direct vs equivalent REG
  const calculatePoolPowerBreakdown = (entry: any) => {
    const poolVotingShare = entry.poolVotingShare || 0
    if (poolVotingShare <= 0) {
      return { powerFromRegDeposit: 0, powerFromEquivalent: 0 }
    }

    // Calculer le total de REG directement déposé dans les pools
    let totalRegDeposit = 0
    let totalEquivalentREG = 0

    if (entry.positions && entry.positions.length > 0) {
      entry.positions.forEach((pos: any) => {
        // Pour les positions V3, examiner les tokens individuels
        if (pos.tokens && pos.tokens.length > 0) {
          pos.tokens.forEach((token: any) => {
            const equivalentREG = parseFloat(token.equivalentREG || '0')
            if (token.tokenSymbol === 'REG') {
              // Token REG direct
              totalRegDeposit += equivalentREG
            } else if (equivalentREG > 0) {
              // Token non-REG avec equivalent REG
              totalEquivalentREG += equivalentREG
            }
          })
        } else {
          // Pour les positions V2 (ou positions sans tokens), vérifier le tokenSymbol de la position
          // Si c'est REG, c'est du REG direct, sinon c'est de l'equivalent REG
          const posRegAmount = pos.regAmount || 0
          if (pos.tokenSymbol === 'REG') {
            totalRegDeposit += posRegAmount
          } else {
            // Pour V2, regAmount vient de equivalentREG, donc c'est de l'equivalent REG
            totalEquivalentREG += posRegAmount
          }
        }
      })
    }

    const totalPoolLiquidity = totalRegDeposit + totalEquivalentREG
    
    // Si on n'a pas de liquidité totale, utiliser poolLiquidityREG comme fallback
    const poolLiquidityREG = entry.poolLiquidityREG || totalPoolLiquidity
    
    if (poolLiquidityREG <= 0) {
      return { powerFromRegDeposit: 0, powerFromEquivalent: 0 }
    }

    // Répartir le poolVotingShare proportionnellement
    const regDepositRatio = totalRegDeposit > 0 ? totalRegDeposit / poolLiquidityREG : 0
    const powerFromRegDeposit = poolVotingShare * regDepositRatio
    const powerFromEquivalent = poolVotingShare - powerFromRegDeposit

    return { powerFromRegDeposit, powerFromEquivalent }
  }

  // Calculer les données pour V2
  const v2PowerTotal = v2Wallets.map((entry) => entry.powerVoting || 0)
  const v2PowerFromPoolsRegDeposit = v2Wallets.map((entry) => {
    const breakdown = calculatePoolPowerBreakdown(entry)
    return breakdown.powerFromRegDeposit
  })
  const v2PowerFromPoolsEquivalent = v2Wallets.map((entry) => {
    const breakdown = calculatePoolPowerBreakdown(entry)
    return breakdown.powerFromEquivalent
  })
  const v2PowerFromDirect = v2Wallets.map((entry) => {
    // Power issu du REG direct en wallet = Power total - Power des pools
    return (entry.powerVoting || 0) - (entry.poolVotingShare || 0)
  })

  // Calculer les données pour V3
  const v3PowerTotal = v3Wallets.map((entry) => entry.powerVoting || 0)
  const v3PowerFromPoolsRegDeposit = v3Wallets.map((entry) => {
    const breakdown = calculatePoolPowerBreakdown(entry)
    return breakdown.powerFromRegDeposit
  })
  const v3PowerFromPoolsEquivalent = v3Wallets.map((entry) => {
    const breakdown = calculatePoolPowerBreakdown(entry)
    return breakdown.powerFromEquivalent
  })
  const v3PowerFromDirect = v3Wallets.map((entry) => {
    // Power issu du REG direct en wallet = Power total - Power des pools
    return (entry.powerVoting || 0) - (entry.poolVotingShare || 0)
  })

  // Combiner les labels : V2 d'abord, puis V3
  const allLabels = [...v2Labels, ...v3Labels]

  return {
    labels: allLabels, // V2 d'abord, puis V3
    datasets: [
      {
        label: 'Power Voting Total (V2)',
        data: [...v2PowerTotal, ...new Array(v3Labels.length).fill(null)],
        borderColor: 'rgba(74, 144, 226, 1)', // Bleu pour V2
        backgroundColor: 'rgba(74, 144, 226, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        spanGaps: false,
      },
      {
        label: 'Power issu de l\'apport REG dans les pools (V2)',
        data: [...v2PowerFromPoolsRegDeposit, ...new Array(v3Labels.length).fill(null)],
        borderColor: 'rgba(59, 130, 246, 1)', // Bleu clair pour V2 pools REG
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderDash: [5, 5],
        spanGaps: false,
      },
      {
        label: 'Power issu de l\'equivalent REG dans les pools (V2)',
        data: [...v2PowerFromPoolsEquivalent, ...new Array(v3Labels.length).fill(null)],
        borderColor: 'rgba(244, 114, 182, 1)', // Rose clair pour V2 pools equivalent
        backgroundColor: 'rgba(244, 114, 182, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderDash: [8, 4],
        spanGaps: false,
      },
      {
        label: 'Power issu du REG direct en wallet (V2)',
        data: [...v2PowerFromDirect, ...new Array(v3Labels.length).fill(null)],
        borderColor: 'rgba(96, 165, 250, 1)', // Bleu très clair pour V2 direct
        backgroundColor: 'rgba(96, 165, 250, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderDash: [2, 2],
        spanGaps: false,
      },
      {
        label: 'Power Voting Total (V3)',
        data: [...new Array(v2Labels.length).fill(null), ...v3PowerTotal],
        borderColor: 'rgba(34, 197, 94, 1)', // Vert pour V3
        backgroundColor: 'rgba(34, 197, 94, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        spanGaps: false,
      },
      {
        label: 'Power issu de l\'apport REG dans les pools (V3)',
        data: [...new Array(v2Labels.length).fill(null), ...v3PowerFromPoolsRegDeposit],
        borderColor: 'rgba(74, 222, 128, 1)', // Vert clair pour V3 pools REG
        backgroundColor: 'rgba(74, 222, 128, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderDash: [5, 5],
        spanGaps: false,
      },
      {
        label: 'Power issu de l\'equivalent REG dans les pools (V3)',
        data: [...new Array(v2Labels.length).fill(null), ...v3PowerFromPoolsEquivalent],
        borderColor: 'rgba(244, 114, 182, 1)', // Rose clair pour V3 pools equivalent
        backgroundColor: 'rgba(244, 114, 182, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderDash: [8, 4],
        spanGaps: false,
      },
      {
        label: 'Power issu du REG direct (V3)',
        data: [...new Array(v2Labels.length).fill(null), ...v3PowerFromDirect],
        borderColor: 'rgba(134, 239, 172, 1)', // Vert très clair pour V3 direct
        backgroundColor: 'rgba(134, 239, 172, 0.15)',
        tension: 0.25,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderDash: [2, 2],
        spanGaps: false,
      },
    ],
  }
})

const powerBreakdownChartOptions = {
  ...chartOptions,
  interaction: { mode: 'index', intersect: false },
  scales: {
    x: {
      ticks: {
        color: '#cbd5e1',
        maxRotation: 45,
        minRotation: 45,
      },
      grid: {
        color: 'rgba(51, 65, 85, 0.3)',
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        color: '#cbd5e1',
      },
      grid: {
        color: 'rgba(51, 65, 85, 0.25)',
      },
      title: {
        display: true,
        text: 'Power Voting',
        color: '#cbd5e1',
        font: {
          size: 14,
          weight: 'bold',
        },
      },
    },
  },
}
</script>

<template>
  <div class="analysis-view" :class="{ 'analysis-view-embedded': props.embedded }" v-if="dataStore.balances.length > 0">
    <div class="analysis-header" id="analyse-donnees" v-if="!props.embedded">
      <div class="header-title-row">
        <h2>📊 {{ t('analysis.dataAnalysis') }}</h2>
        <button type="button" class="copy-link-btn" :title="t('analysis.copySectionLink')" @click.prevent="copySectionLink($event, 'analyse-donnees')" aria-label="Copier le lien">
          <span v-if="copiedAnchorId === 'analyse-donnees'" class="copy-link-feedback">{{ t('analysis.copied') }}</span>
          <span v-else class="copy-link-icon" aria-hidden="true">🔗</span>
        </button>
      </div>
      <p>Exploration et visualisation des balances REG et du pouvoir de vote</p>
    </div>

    <!-- Statistics Cards -->
    <div class="stats-grid">
      <div class="stat-card balance-card">
        <div class="stat-header">
          <h3>💰 {{ t('analysis.balancesReg') }}</h3>
        </div>
        <div class="stat-content" v-if="dataStore.balanceStats">
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.total') }}</span>
            <span class="stat-value">{{ formatNumber(dataStore.balanceStats.total) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.mean') }}</span>
            <span class="stat-value">{{ formatNumber(dataStore.balanceStats.mean) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.median') }}</span>
            <span class="stat-value">{{ formatNumber(dataStore.balanceStats.median) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.minMax') }}</span>
            <span class="stat-value">
              {{ formatNumber(dataStore.balanceStats.min) }} /
              {{ formatNumber(dataStore.balanceStats.max) }}
            </span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.stdDev') }}</span>
            <span class="stat-value">{{ formatNumber(dataStore.balanceStats.stdDev) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Nb wallets</span>
            <span class="stat-value">{{ dataStore.balanceStats.count }}</span>
          </div>
        </div>
      </div>

      <div class="stat-card power-card">
        <div class="stat-header">
          <h3>⚡ {{ t('analysis.powerVoting') }}</h3>
        </div>
        <div class="stat-content" v-if="dataStore.powerVotingStats">
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.total') }}</span>
            <span class="stat-value">{{ formatNumber(dataStore.powerVotingStats.total) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.mean') }}</span>
            <span class="stat-value">{{ formatNumber(dataStore.powerVotingStats.mean) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.median') }}</span>
            <span class="stat-value">{{ formatNumber(dataStore.powerVotingStats.median) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.minMax') }}</span>
            <span class="stat-value">
              {{ formatNumber(dataStore.powerVotingStats.min) }} /
              {{ formatNumber(dataStore.powerVotingStats.max) }}
            </span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.stdDev') }}</span>
            <span class="stat-value">{{ formatNumber(dataStore.powerVotingStats.stdDev) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.nbAddresses') }}</span>
            <span class="stat-value">{{ dataStore.powerVotingStats.count }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Formulaire de recherche d'adresse (2e section : juste au-dessus des graphiques de distribution) -->
    <div class="address-search-section" style="margin: 2rem 0; padding: 1.5rem; background: var(--card-bg); border-radius: 1rem; border: 1px solid var(--border-color);">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0;">
        <h3 style="margin: 0; color: var(--text-primary);">🔍 {{ t('analysis.addressSearch') }}</h3>
        <button
          type="button"
          :title="addressSearchSectionExpanded ? t('analysis.collapseSearch') : t('analysis.expandSearch')"
          @click="addressSearchSectionExpanded = !addressSearchSectionExpanded"
          style="padding: 0.35rem 0.6rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 0.5rem; color: var(--text-primary); cursor: pointer; font-size: 1.1rem; line-height: 1;"
        >
          {{ addressSearchSectionExpanded ? '▼' : '▲' }}
        </button>
      </div>
      <div v-show="addressSearchSectionExpanded" style="margin-top: 1rem;">
      <form @submit.prevent="searchAddressDetails" style="display: flex; gap: 1rem; margin-bottom: 1.5rem;">
        <input
          v-model="addressSearchInput"
          type="text"
          :placeholder="t('analysis.addressPlaceholder')"
          style="flex: 1; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 0.5rem; background: var(--bg-secondary); color: var(--text-primary); font-family: monospace;"
        />
        <button
          type="submit"
          :disabled="isSearchingAddressDetails"
          style="padding: 0.75rem 1.5rem; background: var(--primary-color); color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 600;"
        >
          {{ isSearchingAddressDetails ? t('analysis.searching') : t('analysis.search') }}
        </button>
      </form>

      <!-- Résultats de la recherche -->
      <div v-if="addressDetails" class="address-details" style="margin-top: 1.5rem;">
        <p class="search-result-intro" style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--text-secondary); line-height: 1.4;">
          {{ t('analysis.searchResultIntro') }}
        </p>
        <div class="address-summary-cards" style="padding: 1rem; background: var(--bg-secondary); border-radius: 0.5rem; margin-bottom: 1rem;">
          <h4 style="margin: 0 0 1rem 0; color: var(--text-primary); font-family: monospace;">{{ addressDetails.address }}</h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1.25rem;">
            <div class="summary-card" style="padding: 0.75rem; background: var(--card-bg); border-radius: 0.5rem; border: 1px solid var(--border-color); aspect-ratio: 1; display: flex; flex-direction: column; justify-content: flex-start;">
              <span style="color: var(--text-secondary); font-size: 0.8rem; display: block;">{{ t('analysis.regDirectLabel') }}</span>
              <div style="font-size: 1.25rem; font-weight: 600; color: var(--text-primary); margin-top: 0.25rem;">{{ formatNumber(addressDetails.walletREG) }}</div>
              <span style="font-size: 0.75rem; color: var(--text-secondary);">{{ t('analysis.regDirectDesc') }}</span>
            </div>
            <div class="summary-card" style="padding: 0.75rem; background: var(--card-bg); border-radius: 0.5rem; border: 1px solid var(--border-color);">
              <span style="color: var(--text-secondary); font-size: 0.8rem; display: block;">{{ t('analysis.equivRegLabel') }}</span>
              <div style="font-size: 1.25rem; font-weight: 600; color: var(--text-primary); margin-top: 0.25rem;">{{ formatNumber(addressDetails.poolREG) }}</div>
              <span style="font-size: 0.75rem; color: var(--text-secondary);">{{ t('analysis.equivRegDesc') }}</span>
            </div>
            <div class="summary-card" style="padding: 0.75rem; background: var(--card-bg); border-radius: 0.5rem; border: 1px solid var(--border-color);">
              <span style="color: var(--text-secondary); font-size: 0.8rem; display: block;">{{ t('analysis.regPlusEquivTotal') }}</span>
              <div style="font-size: 1.25rem; font-weight: 600; color: var(--text-primary); margin-top: 0.25rem;">{{ formatNumber(addressDetails.walletREG + addressDetails.poolREG) }}</div>
              <span style="font-size: 0.75rem; color: var(--text-secondary);">{{ t('analysis.regPlusEquivDesc') }}</span>
            </div>
            <div class="summary-card" style="padding: 0.75rem; background: var(--card-bg); border-radius: 0.5rem; border: 1px solid var(--border-color);">
              <span style="color: var(--text-secondary); font-size: 0.8rem; display: block;">{{ t('analysis.powerVoting') }}</span>
              <div style="font-size: 1.25rem; font-weight: 600; color: var(--accent-color); margin-top: 0.25rem;">{{ formatNumber(addressDetails.powerVoting) }}</div>
              <span style="font-size: 0.75rem; color: var(--text-secondary);">{{ t('analysis.powerVotingSnapshotDesc') }}</span>
            </div>
          </div>
        </div>

        <!-- Calcul du Power Voting : tableau REG direct / Équiv. REG → Power -->
        <div v-if="addressDetails.powerBreakdown && addressDetails.powerBreakdown.length > 0" class="power-calc-section" style="margin-top: 1.5rem; padding: 1rem; background: var(--bg-secondary); border-radius: 0.5rem; border: 1px solid var(--border-color);">
          <h4 style="margin: 0 0 0.5rem 0; color: var(--text-primary);">📐 {{ t('analysis.powerCalcTitle') }}</h4>
          <p style="margin: 0 0 1rem 0; font-size: 0.875rem; color: var(--text-secondary);">
            {{ t('analysis.powerCalcTableIntro') }}
          </p>
          <div class="power-calc-table" style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
              <thead>
                <tr style="border-bottom: 2px solid var(--border-color);">
                  <th style="text-align: left; padding: 0.5rem 0.75rem; color: var(--text-secondary); font-weight: 600;">{{ t('analysis.powerCalcSource') }}</th>
                  <th style="text-align: right; padding: 0.5rem 0.75rem; color: var(--text-secondary); font-weight: 600;">{{ t('analysis.powerCalcColRegDirect') }}</th>
                  <th style="text-align: right; padding: 0.5rem 0.75rem; color: var(--text-secondary); font-weight: 600;">{{ t('analysis.powerCalcColEquivReg') }}</th>
                  <th style="text-align: right; padding: 0.5rem 0.75rem; color: var(--text-secondary); font-weight: 600;">→ Power</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(line, idx) in addressDetails.powerBreakdown" :key="idx" style="border-bottom: 1px solid var(--border-color);">
                  <td style="padding: 0.5rem 0.75rem; color: var(--text-primary);">{{ line.label }}</td>
                  <td style="text-align: right; padding: 0.5rem 0.75rem; font-family: monospace;">{{ formatNumber(line.regDirect) }}</td>
                  <td style="text-align: right; padding: 0.5rem 0.75rem; font-family: monospace;">{{ formatNumber(line.equivReg) }}</td>
                  <td style="text-align: right; padding: 0.5rem 0.75rem; font-family: monospace; font-weight: 600; color: var(--accent-color);">{{ formatNumber(line.powerContribution) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr style="border-top: 2px solid var(--border-color); font-weight: 600;">
                  <td style="padding: 0.5rem 0.75rem; color: var(--text-primary);">{{ t('analysis.powerCalcTotal') }}</td>
                  <td style="text-align: right; padding: 0.5rem 0.75rem; font-family: monospace;">{{ formatNumber(addressDetails.walletREG) }}</td>
                  <td style="text-align: right; padding: 0.5rem 0.75rem; font-family: monospace;">{{ formatNumber(addressDetails.poolREG) }}</td>
                  <td style="text-align: right; padding: 0.5rem 0.75rem; font-family: monospace; color: var(--accent-color);">{{ formatNumber(addressDetails.powerVoting) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p style="margin: 1rem 0 0 0; font-size: 0.8rem; color: var(--text-secondary);">
            {{ t('analysis.powerCalcDecompositionNote') }}
          </p>
        </div>

        <!-- Détails des positions -->
        <div v-if="addressDetails.positions && addressDetails.positions.length > 0">
          <h4 style="margin: 0 0 1rem 0; color: var(--text-primary);">{{ t('analysis.positionsInPools') }}</h4>
          <div style="display: grid; gap: 1rem;">
            <div
              v-for="(position, index) in addressDetails.positions"
              :key="index"
              style="padding: 1rem; background: var(--bg-secondary); border-radius: 0.5rem; border-left: 3px solid var(--primary-color);"
            >
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                <div>
                  <span style="color: var(--text-secondary); font-size: 0.875rem;">{{ t('analysis.dexPool') }}</span>
                  <div style="font-weight: 600; color: var(--text-primary);">{{ position.dex }} {{ position.poolType?.toUpperCase() || 'V2' }}</div>
                </div>
                <div>
                  <span style="color: var(--text-secondary); font-size: 0.875rem;">{{ t('analysis.version') }}</span>
                  <div style="font-weight: 600; color: var(--text-primary);">{{ position.poolType === 'v3' ? 'V3' : 'V2' }}</div>
                </div>
                <div>
                  <span style="color: var(--text-secondary); font-size: 0.875rem;">{{ t('analysis.regEquivalent') }}</span>
                  <div style="font-weight: 600; color: var(--text-primary);">{{ formatNumber(position.regAmount) }}</div>
                </div>
                <div>
                  <span style="color: var(--text-secondary); font-size: 0.875rem;">{{ t('analysis.status') }}</span>
                  <div style="font-weight: 600;" :style="{ color: position.isActive ? 'rgba(34, 197, 94, 1)' : 'rgba(239, 68, 68, 1)' }">
                    {{ position.isActive ? '🟢 ' + t('analysis.activeInRange') : '🔴 ' + t('analysis.inactiveOutOfRange') }}
                  </div>
                </div>
                <template v-if="position.tokens && position.tokens.length > 0">
                  <div v-for="(token, ti) in position.tokens" :key="ti">
                    <span style="color: var(--text-secondary); font-size: 0.875rem;">{{ token.tokenSymbol }}</span>
                    <div style="font-weight: 600; color: var(--text-primary);">{{ formatNumber(parseFloat(token.tokenBalance)) }} {{ token.tokenSymbol }}</div>
                  </div>
                </template>
                <div v-else-if="position.counterpartAmount > 0">
                  <span style="color: var(--text-secondary); font-size: 0.875rem;">{{ t('analysis.counterpart') }}</span>
                  <div style="font-weight: 600; color: var(--text-primary);">{{ formatNumber(position.counterpartAmount) }} {{ position.counterpartToken || '' }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-else style="padding: 1rem; background: var(--bg-secondary); border-radius: 0.5rem; color: var(--text-secondary); text-align: center;">
          {{ t('analysis.noPositionInPools') }}
        </div>

        <!-- Évolution de l'adresse par snapshot (rang + % vs précédent) -->
        <div class="address-evolution-section" style="margin-top: 2rem;">
          <h4 style="margin: 0 0 1rem 0; color: var(--text-primary);">📈 {{ t('analysis.addressEvolutionBySnapshot') }}</h4>
          <p v-if="isLoadingAddressEvolution" style="color: var(--text-secondary); margin: 0;">{{ t('analysis.loadingPreviousSnapshot') }}</p>
          <div v-else-if="addressEvolutionBySnapshot.length > 0" class="address-evolution-table-wrapper" style="overflow-x: auto;">
            <table class="address-evolution-table">
              <thead>
                <tr>
                  <th class="addr-evol-col-date">{{ t('analysis.snapshotDate') }}</th>
                  <th class="addr-evol-col-rank">{{ t('analysis.rank') }}</th>
                  <th class="addr-evol-col-power">{{ t('analysis.powerVotingValue') }}</th>
                  <th class="addr-evol-col-evol">{{ t('analysis.placeChange') }}</th>
                  <th class="addr-evol-col-pct">{{ t('analysis.pctTotalPower') }}</th>
                  <th class="addr-evol-col-pctdiff">{{ t('analysis.pctChange') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, idx) in addressEvolutionBySnapshot"
                  :key="row.date + (row.dateFormatted || '')"
                  class="address-evolution-row"
                  :class="{ 'address-evolution-current': row.isCurrent }"
                >
                  <td class="addr-evol-col-date">{{ row.dateFormatted }}</td>
                  <td class="addr-evol-col-rank">
                    <span v-if="row.rank === null">—</span>
                    <span v-else>#{{ row.rank }}</span>
                  </td>
                  <td class="addr-evol-col-power" style="font-family: monospace;">{{ formatNumber(row.power) }}</td>
                  <td class="addr-evol-col-evol">
                    <span v-if="row.rankChange === null">—</span>
                    <span v-else-if="row.rankChange === 0">—</span>
                    <span v-else-if="row.rankChange > 0" class="top-holders-positive">
                      {{ row.rankChange }} {{ row.rankChange === 1 ? t('analysis.placeGained') : t('analysis.placesGained') }}
                    </span>
                    <span v-else class="top-holders-negative">
                      {{ Math.abs(row.rankChange) }} {{ Math.abs(row.rankChange) === 1 ? t('analysis.placeLost') : t('analysis.placesLost') }}
                    </span>
                  </td>
                  <td class="addr-evol-col-pct">{{ formatNumber(row.pct) }}%</td>
                  <td class="addr-evol-col-pctdiff">
                    <span v-if="row.pctChange === null">—</span>
                    <span v-else-if="row.pctChange === 0">—</span>
                    <span v-else :class="row.pctChange > 0 ? 'top-holders-positive' : 'top-holders-negative'">
                      {{ row.pctChange > 0 ? '+' : '' }}{{ formatNumber(row.pctChange) }}%
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts-grid">
      <div class="chart-card">
        <h3>📈 {{ t('analysis.distributionBalancesByAddress') }}</h3>
        <div class="chart-container" v-if="balanceDistributionChartData">
          <Bar :data="balanceDistributionChartData" :options="countChartOptions" />
        </div>
      </div>

      <div class="chart-card">
        <h3>📊 {{ t('analysis.distributionByAddress') }}</h3>
        <div class="chart-container" v-if="powerVotingDistributionChartData">
          <Bar :data="powerVotingDistributionChartData" :options="countChartOptions" />
        </div>
      </div>
    </div>

    <p class="chart-note" v-if="balanceDistributionChartData">
      {{ t('analysis.chartNoteBalances') }}
    </p>

    <!-- Power Concentration Section -->
    <div class="section-header" id="concentration-pouvoir" v-if="powerConcentrationData">
      <div class="header-title-row">
        <h2>⚖️ {{ t('analysis.powerConcentration') }}</h2>
        <button type="button" class="copy-link-btn" :title="t('analysis.copySectionLink')" @click.prevent="copySectionLink($event, 'concentration-pouvoir')" aria-label="Copier le lien">
          <span v-if="copiedAnchorId === 'concentration-pouvoir'" class="copy-link-feedback">{{ t('analysis.copied') }}</span>
          <span v-else class="copy-link-icon" aria-hidden="true">🔗</span>
        </button>
      </div>
      <p>{{ t('analysis.powerConcentrationDesc') }}</p>
    </div>

    <div v-if="powerConcentrationData" class="concentration-section">
      <!-- Gini Coefficient Card -->
      <div class="stat-card gini-card">
        <div class="stat-header">
          <h3>📊 {{ t('analysis.giniIndex') }}</h3>
        </div>
        <div class="stat-content">
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.coefficient') }}</span>
            <span class="stat-value gini-value">{{ giniCoefficient !== null ? giniCoefficient.toFixed(4) : 'N/A' }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.totalPowerVoting') }}</span>
            <span class="stat-value">{{ formatNumber(powerConcentrationData.totalPower) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.addressCount') }}</span>
            <span class="stat-value">{{ formatInteger(powerConcentrationData.totalAddresses) }}</span>
          </div>
        </div>
      </div>

      <!-- Concentration Table -->
      <div class="concentration-table-card">
        <h3>📈 {{ t('analysis.percentileBreakdown') }}</h3>
        <div class="concentration-table">
          <div class="concentration-table-header">
            <div class="concentration-col">{{ t('analysis.percentile') }}</div>
            <div class="concentration-col">{{ t('analysis.nbAddresses') }}</div>
            <div class="concentration-col">{{ t('analysis.powerHeld') }}</div>
            <div class="concentration-col">{{ t('analysis.pctTotal') }}</div>
          </div>
          <div
            v-for="item in powerConcentrationData.concentration.filter(c => [5, 10, 15, 20, 25, 50, 75, 90, 95, 100].includes(c.percentile))"
            :key="item.percentile"
            class="concentration-table-row"
          >
            <div class="concentration-col percentile-col">{{ t('analysis.topX', { p: item.percentile }) }}</div>
            <div class="concentration-col">{{ formatInteger(item.addressCount) }}</div>
            <div class="concentration-col">{{ formatNumber(item.powerHeld) }}</div>
            <div class="concentration-col percentage-col">{{ formatNumber(item.powerPercentage) }}%</div>
          </div>
        </div>
      </div>

      <!-- Charts Grid -->
      <div class="charts-grid">
        <div class="chart-card">
          <h3>📊 {{ t('analysis.concentrationByPercentile') }}</h3>
          <div class="chart-container" v-if="powerConcentrationChartData">
            <Bar :data="powerConcentrationChartData" :options="powerConcentrationChartOptions" />
          </div>
        </div>

        <div class="chart-card">
          <h3>📈 {{ t('analysis.lorenzCurve') }}</h3>
          <div class="chart-container" v-if="lorenzCurveData">
            <Line :data="lorenzCurveData" :options="lorenzCurveChartOptions" />
          </div>
          <p class="chart-note" style="margin-top: 1rem; font-size: 0.875rem; color: var(--text-secondary);">
            {{ t('analysis.lorenzNote') }}
          </p>
        </div>
      </div>
    </div>

    <!-- Pools Analysis Section -->
    <div class="section-header" id="analyse-pools">
      <div class="header-title-row">
        <h2>🌊 {{ t('analysis.poolsAnalysis') }}</h2>
        <button type="button" class="copy-link-btn" :title="t('analysis.copySectionLink')" @click="copySectionLink('analyse-pools')" aria-label="Copier le lien">
          <span v-if="copiedAnchorId === 'analyse-pools'" class="copy-link-feedback">{{ t('analysis.copied') }}</span>
          <span v-else class="copy-link-icon" aria-hidden="true">🔗</span>
        </button>
      </div>
      <p>{{ t('analysis.liquidityBreakdown') }}</p>
    </div>

    <div class="stats-grid" v-if="dataStore.poolAnalysis">
      <div class="stat-card v2-card">
        <div class="stat-header">
          <h3>💧 {{ t('analysis.poolsV2') }}</h3>
        </div>
        <div class="stat-content">
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.totalReg') }}</span>
            <span class="stat-value">{{ formatNumber(dataStore.poolAnalysis.v2.totalREG) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.nbPositions') }}</span>
            <span class="stat-value">{{ dataStore.poolAnalysis.v2.count }}</span>
          </div>
        </div>
      </div>

      <div class="stat-card v3-card">
        <div class="stat-header">
          <h3>🦄 {{ t('analysis.poolsV3') }}</h3>
        </div>
        <div class="stat-content">
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.totalReg') }}</span>
            <span class="stat-value">{{ formatNumber(dataStore.poolAnalysis.v3.totalREG) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ t('analysis.nbPositions') }}</span>
            <span class="stat-value">{{ dataStore.poolAnalysis.v3.count }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <h3>🥧 {{ t('analysis.breakdownV2V3') }}</h3>
        <div class="chart-container" v-if="poolsDistributionChartData">
          <Doughnut :data="poolsDistributionChartData" :options="chartOptions" />
        </div>
      </div>

      <div class="chart-card">
        <h3>🏦 {{ t('analysis.breakdownByDex') }}</h3>
        <div class="chart-container" v-if="dexsDistributionChartData">
          <Bar :data="dexsDistributionChartData" :options="chartOptions" />
        </div>
      </div>
    </div>


    <div class="section-header" id="impact-dex" style="margin-top: 3rem;">
      <div class="header-title-row">
        <h2>⚡ {{ t('analysis.dexBoostImpact') }}</h2>
        <button type="button" class="copy-link-btn" :title="t('analysis.copySectionLink')" @click.prevent="copySectionLink($event, 'impact-dex')" aria-label="Copier le lien">
          <span v-if="copiedAnchorId === 'impact-dex'" class="copy-link-feedback">{{ t('analysis.copied') }}</span>
          <span v-else class="copy-link-icon" aria-hidden="true">🔗</span>
        </button>
      </div>
      <p>{{ t('analysis.dexBoostSectionDesc') }}</p>
    </div>

    <div class="charts-grid correlation-grid">
      <div class="chart-card full-width">
        <h3>📊 {{ t('analysis.ratioChart') }}</h3>
        <div class="chart-container" v-if="dexBoostChartData">
          <Line :data="dexBoostChartData" :options="dexBoostChartOptions" />
        </div>
        <div class="chart-empty" v-else>
          <p>{{ t('analysis.noWalletDex') }}</p>
        </div>
      </div>
    </div>

    <div class="chart-explainer" style="margin-top: 1rem;">
      <p v-html="t('analysis.ratioChartIntro')"></p>
      <ul style="margin: 1rem 0; padding-left: 1.5rem; color: var(--text-secondary);">
        <li style="margin-bottom: 0.75rem;">
          <strong>{{ t('analysis.formulaLabel') }}</strong> : <code>Power Voting ÷ totalBalanceREG</code>
          <br />
          <span style="font-size: 0.9em; opacity: 0.8;">{{ t('analysis.formulaDetail') }}</span>
        </li>
        <li style="margin-bottom: 0.75rem;">{{ t('analysis.addressesShown') }}</li>
        <li style="margin-bottom: 0.75rem;">
          <strong>{{ t('analysis.legendColors') }}</strong> :
          <br />• <strong style="color: rgba(74, 144, 226, 1);">Bleu</strong> : {{ t('analysis.blueV2') }}
          <br />• <strong style="color: rgba(34, 197, 94, 1);">Vert</strong> : {{ t('analysis.greenV3') }}
          <br />• <strong style="color: rgba(148, 163, 184, 0.8);">Gris (pointillé)</strong> : {{ t('analysis.greyRef') }}
          <br />
          <br /><strong>{{ t('analysis.rangeIndicatorsTitle') }}</strong> :
          <br />• <strong style="color: rgba(34, 197, 94, 1);">🟢</strong> {{ t('analysis.greenPoint') }}
          <br />• <strong style="color: rgba(239, 68, 68, 1);">🔴</strong> {{ t('analysis.redPoint') }}
          <br />• <strong style="color: rgba(234, 179, 8, 1);">🟡</strong> {{ t('analysis.yellowPoint') }}
        </li>
      </ul>
      <p style="margin-top: 1rem;">
        <strong>{{ t('analysis.interpretationTitle') }}</strong> :
        <ul style="margin: 0.5rem 0; padding-left: 1.5rem; color: var(--text-secondary);">
          <li>{{ t('analysis.above11') }}</li>
          <li>{{ t('analysis.at11') }}</li>
          <li>{{ t('analysis.below11') }}</li>
        </ul>
      </p>
      <p class="axis-note" style="margin-top: 1rem;">
        <strong>{{ t('common.note') }}</strong> : {{ t('analysis.noteRatioChart') }}
      </p>
    </div>

    <div class="section-header" id="decomposition" style="margin-top: 3rem;">
      <div class="header-title-row">
        <h2>📊 {{ t('analysis.decomposition') }}</h2>
        <button type="button" class="copy-link-btn" :title="t('analysis.copySectionLink')" @click="copySectionLink('decomposition')" aria-label="Copier le lien">
          <span v-if="copiedAnchorId === 'decomposition'" class="copy-link-feedback">{{ t('analysis.copied') }}</span>
          <span v-else class="copy-link-icon" aria-hidden="true">🔗</span>
        </button>
      </div>
      <p>{{ t('analysis.decompositionSectionDesc') }}</p>
    </div>

    <div class="charts-grid correlation-grid">
      <div class="chart-card full-width">
        <h3>📊 {{ t('analysis.totalPoolsReg') }}</h3>
        <div class="chart-container" v-if="powerBreakdownChartData">
          <Line :data="powerBreakdownChartData" :options="powerBreakdownChartOptions" />
        </div>
        <div class="chart-empty" v-else>
          <p>{{ t('analysis.noWalletDex') }}</p>
        </div>
      </div>
    </div>

    <div class="chart-explainer" style="margin-top: 1rem;">
      <p v-html="t('analysis.decompositionIntro')"></p>
      <ul style="margin: 1rem 0; padding-left: 1.5rem; color: var(--text-secondary);">
        <li style="margin-bottom: 0.75rem;">
          <strong>{{ t('analysis.powerTotalLabel') }}</strong> : {{ t('analysis.powerTotalDesc') }}
        </li>
        <li style="margin-bottom: 0.75rem;">
          <strong>{{ t('analysis.powerFromRegInPoolsLabel') }}</strong> : {{ t('analysis.powerFromRegInPoolsDesc') }}
        </li>
        <li style="margin-bottom: 0.75rem;">
          <strong>{{ t('analysis.powerFromEquivalentRegLabel') }}</strong> : {{ t('analysis.powerFromEquivalentRegDesc') }}
        </li>
        <li style="margin-bottom: 0.75rem;">
          <strong>{{ t('analysis.powerFromDirectRegLabel') }}</strong> : {{ t('analysis.powerFromDirectRegDesc') }}
        </li>
        <li style="margin-bottom: 0.75rem;">{{ t('analysis.decompositionAddressesShown') }}</li>
        <li style="margin-bottom: 0.75rem;">
          <strong>{{ t('analysis.legendColors') }}</strong> :
          <br />• <strong style="color: rgba(74, 144, 226, 1);">Bleu (plein)</strong> : {{ t('analysis.blueSolidV2') }}
          <br />• <strong style="color: rgba(59, 130, 246, 1);">Bleu (pointillé moyen)</strong> : {{ t('analysis.blueDashedV2') }}
          <br />• <strong style="color: rgba(244, 114, 182, 1);">Rose clair (pointillé large)</strong> : {{ t('analysis.pinkV2') }}
          <br />• <strong style="color: rgba(96, 165, 250, 1);">Bleu clair (pointillé fin)</strong> : {{ t('analysis.lightBlueV2') }}
          <br />• <strong style="color: rgba(34, 197, 94, 1);">Vert (plein)</strong> : {{ t('analysis.greenSolidV3') }}
          <br />• <strong style="color: rgba(74, 222, 128, 1);">Vert (pointillé moyen)</strong> : {{ t('analysis.greenDashedV3') }}
          <br />• <strong style="color: rgba(244, 114, 182, 1);">Rose clair (pointillé large)</strong> : {{ t('analysis.pinkV3') }}
          <br />• <strong style="color: rgba(134, 239, 172, 1);">Vert clair (pointillé fin)</strong> : {{ t('analysis.lightGreenV3') }}
        </li>
      </ul>
      <p style="margin-top: 1rem;">
        <strong>{{ t('analysis.interpretationTitle') }}</strong> :
        <ul style="margin: 0.5rem 0; padding-left: 1.5rem; color: var(--text-secondary);">
          <li>{{ t('analysis.interpPowerTotal') }}</li>
          <li>{{ t('analysis.interpRegVsEquivalent') }}</li>
          <li>{{ t('analysis.interpPoolsVsDirect') }}</li>
          <li>{{ t('analysis.interpV2V3Diff') }}</li>
        </ul>
      </p>
      <p class="axis-note" style="margin-top: 1rem;">
        <strong>{{ t('common.note') }}</strong> : {{ t('analysis.noteDecomposition') }}
      </p>
    </div>

    <div class="pool-wallet-summary" v-if="dataStore.poolWalletBreakdown" style="margin: 1.5rem 0;">
      <div class="summary-item">
        <span class="summary-label">{{ t('analysis.walletsV2') }}</span>
        <span class="summary-value">{{ formatInteger(dataStore.poolWalletBreakdown.v2Wallets) }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">{{ t('analysis.walletsV3') }}</span>
        <span class="summary-value">{{ formatInteger(dataStore.poolWalletBreakdown.v3Wallets) }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">{{ t('analysis.walletsV2AndV3') }}</span>
        <span class="summary-value">{{ formatInteger(dataStore.poolWalletBreakdown.both) }}</span>
      </div>
    </div>

    <!-- Comparaison top holders Power Voting vs snapshot précédent -->
    <div class="section-header" id="comparaison-top-holders" v-if="top20HoldersComparison && top20HoldersComparison.length > 0">
      <div class="header-title-row">
        <h2>📊 {{ t('analysis.topHoldersComparisonTitle') }}</h2>
        <button type="button" class="copy-link-btn" :title="t('analysis.copySectionLink')" @click.prevent="copySectionLink($event, 'comparaison-top-holders')" aria-label="Copier le lien">
          <span v-if="copiedAnchorId === 'comparaison-top-holders'" class="copy-link-feedback">{{ t('analysis.copied') }}</span>
          <span v-else class="copy-link-icon" aria-hidden="true">🔗</span>
        </button>
      </div>
      <p>{{ t('analysis.topHoldersComparisonDesc') }}</p>
    </div>
    <div v-if="top20HoldersComparison && top20HoldersComparison.length > 0" class="top-holders-comparison-section">
      <div class="top-holders-table-card">
        <p v-if="isLoadingPreviousForTopHolders" class="top-holders-loading">{{ t('analysis.loadingPreviousSnapshot') }}</p>
        <p v-else-if="!previousSnapshotPowerData" class="top-holders-no-prev">{{ t('analysis.noPreviousSnapshot') }}</p>
        <div v-else class="top-holders-table-wrapper">
          <table class="top-holders-table">
            <thead>
              <tr>
                <th class="top-holders-col-rank">{{ t('analysis.rank') }}</th>
                <th class="top-holders-col-address">{{ t('analysis.address') }}</th>
                <th class="top-holders-col-power">{{ t('analysis.powerVoting') }}</th>
                <th class="top-holders-col-pct">{{ t('analysis.pctTotalPower') }}</th>
                <th class="top-holders-col-place">{{ t('analysis.placeChange') }}</th>
                <th class="top-holders-col-pctdiff">{{ t('analysis.pctChange') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in top20HoldersComparison"
                :key="row.address"
                class="top-holders-row"
              >
                <td class="top-holders-col-rank">{{ row.rank }}</td>
                <td class="top-holders-col-address" :title="row.address">
                  <span class="top-holders-address-text">{{ row.address }}</span>
                </td>
                <td class="top-holders-col-power">{{ formatNumber(row.power) }}</td>
                <td class="top-holders-col-pct">{{ formatNumber(row.pctTotal) }}%</td>
                <td class="top-holders-col-place">
                  <span v-if="row.placeChange === null">—</span>
                  <span v-else-if="row.placeChange === 0">—</span>
                  <span
                    v-else-if="row.placeChange > 0"
                    class="top-holders-positive"
                  >
                    {{ row.placeChange }} {{ row.placeChange === 1 ? t('analysis.placeGained') : t('analysis.placesGained') }}
                  </span>
                  <span v-else class="top-holders-negative">
                    {{ Math.abs(row.placeChange) }} {{ Math.abs(row.placeChange) === 1 ? t('analysis.placeLost') : t('analysis.placesLost') }}
                  </span>
                </td>
                <td class="top-holders-col-pctdiff">
                  <span v-if="row.pctDiff === null">—</span>
                  <span
                    v-else
                    :class="row.pctDiff > 0 ? 'top-holders-positive' : row.pctDiff < 0 ? 'top-holders-negative' : ''"
                  >
                    {{ row.pctDiff > 0 ? '+' : '' }}{{ formatNumber(row.pctDiff) }}%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Graphiques évolution rang et % (vert = gain, rouge = perte) -->
      <div class="top-holders-charts-grid" v-if="top20RankEvolutionChartData && top20PctEvolutionChartData">
        <div class="top-holders-chart-card">
          <h3 class="top-holders-chart-title">📈 {{ t('analysis.rankEvolutionChartTitle') }}</h3>
          <div class="top-holders-chart-container">
            <Bar :data="top20RankEvolutionChartData" :options="topHoldersRankChartOptions()" />
          </div>
        </div>
        <div class="top-holders-chart-card">
          <h3 class="top-holders-chart-title">📊 {{ t('analysis.pctEvolutionChartTitle') }}</h3>
          <div class="top-holders-chart-container">
            <Bar :data="top20PctEvolutionChartData" :options="topHoldersPctChartOptions()" />
          </div>
        </div>
      </div>

      <!-- Ancien top 20 : où sont-ils dans le classement actuel ? -->
      <div class="previous-top20-card" v-if="previousTop20CurrentRanks && previousTop20CurrentRanks.length > 0">
        <h3 class="previous-top20-title">📋 {{ t('analysis.previousTop20Title') }}</h3>
        <p class="previous-top20-desc">{{ t('analysis.previousTop20Desc') }}</p>
        <div class="previous-top20-table-wrapper">
          <table class="previous-top20-table">
            <thead>
              <tr>
                <th class="previous-top20-col-rank">{{ t('analysis.rank') }} ({{ t('analysis.previousSnapshotShort') }})</th>
                <th class="previous-top20-col-address">{{ t('analysis.address') }}</th>
                <th class="previous-top20-col-current">{{ t('analysis.currentRank') }}</th>
                <th class="previous-top20-col-evol">{{ t('analysis.placeChange') }}</th>
                <th class="previous-top20-col-pctdiff">{{ t('analysis.pctChange') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in previousTop20CurrentRanks" :key="row.address" class="previous-top20-row">
                <td class="previous-top20-col-rank">{{ row.previousRank }}</td>
                <td class="previous-top20-col-address" :title="row.addressDisplay">
                  <span class="previous-top20-address-text">{{ row.addressDisplay }}</span>
                </td>
                <td class="previous-top20-col-current">
                  <span v-if="row.currentRank === null">—</span>
                  <span v-else>#{{ row.currentRank }}</span>
                </td>
                <td class="previous-top20-col-evol">
                  <span v-if="row.placeChange === null">—</span>
                  <span v-else-if="row.placeChange === 0">—</span>
                  <span
                    v-else-if="row.placeChange > 0"
                    class="top-holders-negative"
                  >
                    {{ row.placeChange }} {{ row.placeChange === 1 ? t('analysis.placeLost') : t('analysis.placesLost') }}
                  </span>
                  <span v-else class="top-holders-positive">
                    {{ Math.abs(row.placeChange) }} {{ Math.abs(row.placeChange) === 1 ? t('analysis.placeGained') : t('analysis.placesGained') }}
                  </span>
                </td>
                <td class="previous-top20-col-pctdiff">
                  <span v-if="row.pctDiff === 0">—</span>
                  <span
                    v-else
                    :class="row.pctDiff > 0 ? 'top-holders-positive' : 'top-holders-negative'"
                  >
                    {{ row.pctDiff > 0 ? '+' : '' }}{{ formatNumber(row.pctDiff) }}%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Snapshots historiques (masqué en mode intégré, la liste est sur la home) -->
    <div class="historical-snapshots-section" id="snapshots-historiques" v-if="!props.embedded && allSnapshotsWithCurrent.length > 0">
      <div class="historical-snapshots-header">
        <div class="header-title-row header-title-row-h3">
          <h3>📸 {{ t('analysis.historicalSnapshots', { count: allSnapshotsWithCurrent.length }) }}</h3>
          <button type="button" class="copy-link-btn" :title="t('analysis.copySectionLink')" @click.prevent="copySectionLink($event, 'snapshots-historiques')" aria-label="Copier le lien">
            <span v-if="copiedAnchorId === 'snapshots-historiques'" class="copy-link-feedback">{{ t('analysis.copied') }}</span>
            <span v-else class="copy-link-icon" aria-hidden="true">🔗</span>
          </button>
        </div>
        <p>{{ t('analysis.historicalSnapshotsDesc') }}</p>
      </div>
      <div class="historical-snapshots-list">
        <button
          v-for="snapshot in allSnapshotsWithCurrent"
          :key="snapshot.date"
          @click="snapshot.date === 'Actuel' ? null : loadSnapshotData(snapshot)"
          :disabled="isLoadingComparison || snapshot.date === 'Actuel'"
          class="historical-snapshot-row"
          :class="{ 'historical-current-snapshot-row': snapshot.date === 'Actuel' }"
        >
          <div class="historical-snapshot-date-col">
            <div class="historical-snapshot-date">{{ snapshot.date === 'Actuel' ? 'Snapshot actuel (uploadé)' : formatSnapshotDate(snapshot.date) }}</div>
          </div>
          <div class="historical-snapshot-metrics-row" v-if="snapshot.metrics">
            <div class="historical-snapshot-metric-item">
              <span class="historical-metric-icon">👥</span>
              <div class="historical-metric-content">
                <div class="historical-metric-value-row">
                  <span class="historical-metric-value">{{ formatInteger(snapshot.metrics.walletCount) }}</span>
                  <span
                    v-if="getSnapshotDiff(snapshot, allSnapshotsWithCurrent)"
                    class="historical-metric-diff"
                    :class="getSnapshotDiff(snapshot, allSnapshotsWithCurrent)!.walletCount >= 0 ? 'positive' : 'negative'"
                  >
                    {{ formatDiff(getSnapshotDiff(snapshot, allSnapshotsWithCurrent)!.walletCount, true) }}
                  </span>
                </div>
                <span class="historical-metric-label">wallets</span>
              </div>
            </div>
            <div class="historical-snapshot-metric-item">
              <span class="historical-metric-icon">💰</span>
              <div class="historical-metric-content">
                <div class="historical-metric-value-row">
                  <span class="historical-metric-value">{{ formatNumber(snapshot.metrics.totalREG) }}</span>
                  <span
                    v-if="getSnapshotDiff(snapshot, allSnapshotsWithCurrent)"
                    class="historical-metric-diff"
                    :class="getSnapshotDiff(snapshot, allSnapshotsWithCurrent)!.totalREG >= 0 ? 'positive' : 'negative'"
                  >
                    {{ formatDiff(getSnapshotDiff(snapshot, allSnapshotsWithCurrent)!.totalREG) }}
                  </span>
                </div>
                <span class="historical-metric-label">REG</span>
              </div>
            </div>
            <div class="historical-snapshot-metric-item">
              <span class="historical-metric-icon">⚡</span>
              <div class="historical-metric-content">
                <div class="historical-metric-value-row">
                  <span class="historical-metric-value">{{ formatNumber(snapshot.metrics.totalPowerVoting) }}</span>
                  <span
                    v-if="getSnapshotDiff(snapshot, allSnapshotsWithCurrent)"
                    class="historical-metric-diff"
                    :class="getSnapshotDiff(snapshot, allSnapshotsWithCurrent)!.totalPowerVoting >= 0 ? 'positive' : 'negative'"
                  >
                    {{ formatDiff(getSnapshotDiff(snapshot, allSnapshotsWithCurrent)!.totalPowerVoting) }}
                  </span>
                </div>
                <span class="historical-metric-label">Power</span>
              </div>
            </div>
          </div>
          <div class="historical-snapshot-files" v-else>
            <span class="historical-snapshot-file">📄 {{ snapshot.balancesFile }}</span>
            <span class="historical-snapshot-file">⚡ {{ snapshot.powerVotingFile }}</span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.analysis-view {
  animation: fadeIn 0.5s ease;
}

.analysis-view-embedded {
  padding-top: 0;
  margin-top: 0;
}

.analysis-header {
  text-align: center;
  margin-bottom: 2.5rem;
}

.analysis-header h2 {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
  background: var(--primary-color);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.analysis-header p {
  color: var(--text-secondary);
  font-size: 1.125rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2.5rem;
}

.stat-card {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-color);
  border-radius: 1rem;
  padding: 2rem;
  box-shadow: var(--shadow-lg);
  transition: all 0.3s ease;
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-xl);
}

.stat-header {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid var(--border-color);
}

.stat-header h3 {
  font-size: 1.5rem;
  color: var(--text-primary);
}

.stat-content {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-muted);
  font-weight: 500;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.balance-card .stat-value {
  color: var(--primary-color);
}

.power-card .stat-value {
  color: var(--accent-color);
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2.5rem;
}

.chart-card {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-color);
  border-radius: 1rem;
  padding: 2rem;
  box-shadow: var(--shadow-lg);
}

.chart-card h3 {
  font-size: 1.25rem;
  margin-bottom: 1.5rem;
  color: var(--text-primary);
}

.chart-container {
  height: 350px;
}

.chart-card.full-width {
  grid-column: 1 / -1;
}

.correlation-grid {
  grid-template-columns: 1fr;
}

.chart-empty {
  height: 350px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px dashed var(--border-color);
  border-radius: 0.75rem;
}

.chart-note {
  margin-top: -1rem;
  margin-bottom: 2rem;
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.6;
}

.pool-wallet-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.summary-item {
  flex: 1 1 200px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  padding: 1rem 1.25rem;
  box-shadow: var(--shadow-md);
}

.summary-label {
  display: block;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.summary-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
}

.chart-explainer {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  padding: 1.25rem 1.5rem;
  margin-bottom: 2rem;
  color: var(--text-secondary);
  line-height: 1.6;
  box-shadow: var(--shadow-md);
}

.chart-explainer strong {
  color: var(--text-primary);
}

.chart-explainer em {
  color: var(--accent-color);
}

.chart-explainer .axis-note {
  margin-top: 0.5rem;
  font-size: 0.9rem;
  color: var(--text-muted);
}

.top-holders-section {
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 2px solid var(--border-color);
}

.top-holders-title {
  font-size: 2rem;
  margin-bottom: 2rem;
  text-align: center;
  color: var(--text-primary);
  background: var(--primary-color);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.top-holders-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 1.5rem;
}

.top-card {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-color);
  border-radius: 1rem;
  padding: 2rem;
  box-shadow: var(--shadow-lg);
  transition: all 0.3s ease;
}

.top-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-xl);
}

.top-card h3 {
  font-size: 1.25rem;
  margin-bottom: 1.5rem;
  color: var(--text-primary);
}

.top-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.top-item {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 1rem;
  align-items: center;
  padding: 1rem;
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  transition: all 0.3s ease;
}

.top-item:hover {
  background: var(--bg-tertiary);
  transform: translateX(4px);
}

.rank {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  background: var(--primary-color);
  color: white;
  border-radius: 50%;
  font-weight: 700;
  font-size: 0.875rem;
}

.address {
  font-family: 'Courier New', monospace;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.3s ease;
  user-select: all;
}

.address:hover {
  color: var(--primary-color);
}

.btn-copy-address {
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  padding: 0.5rem;
  cursor: pointer;
  transition: all 0.3s ease;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
}

.btn-copy-address:hover {
  background: var(--primary-color);
  border-color: var(--primary-color);
  transform: scale(1.1);
}

.btn-copy-address:active {
  transform: scale(0.95);
}

.value {
  font-weight: 700;
  color: var(--text-primary);
  text-align: right;
}

.correlation-table {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  margin-bottom: 2.5rem;
}

.correlation-row {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 1rem;
  padding: 1.5rem;
  box-shadow: var(--shadow-lg);
}

.row-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1.5rem;
  justify-content: space-between;
}

.positions-count .metric-value {
  color: var(--secondary-color);
}

.positions-toggle {
  margin-left: auto;
  padding: 0.6rem 1rem;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.positions-toggle:hover {
  background: var(--primary-color);
  color: #0f172a;
}

.row-details {
  margin-top: 1.25rem;
  border-top: 1px dashed var(--border-color);
  padding-top: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.detail-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}

.address-block {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.address-short {
  font-weight: 700;
  color: var(--text-primary);
}

.address-full {
  font-family: 'Courier New', monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 120px;
}

.metric-label {
  font-size: 0.875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.metric-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.positions-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

.position-pill {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--border-color);
  border-radius: 0.75rem;
  font-size: 0.85rem;
  min-width: 200px;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.position-pill.position-active {
  border-left-color: #22c55e !important; /* Vert plus pétant pour actif */
  background-color: rgba(34, 197, 94, 0.1);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.15);
}

.position-pill.position-inactive {
  border-left-color: #f87171 !important; /* Rouge plus doux et cohérent pour inactif */
  background-color: rgba(248, 113, 113, 0.08);
}

.position-pill-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.position-pill-details {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-color);
}

.pill-dex {
  font-weight: 600;
  color: var(--primary-color);
}

.pill-pool {
  font-family: 'Courier New', monospace;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.pill-value {
  font-weight: 600;
  color: var(--text-primary);
}

.pill-power {
  font-weight: 500;
  color: var(--accent-color);
  font-size: 0.8rem;
}

.pill-multiplier {
  font-weight: 700;
  color: var(--primary-color);
  font-size: 0.9rem;
  background: rgba(99, 102, 241, 0.1);
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
}

.pill-more {
  align-self: center;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.no-data {
  text-align: center;
  padding: 4rem 2rem;
  background: var(--card-bg);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
}

.no-data p {
  font-size: 1.25rem;
  color: var(--text-secondary);
  margin-bottom: 2rem;
}

@media (max-width: 768px) {
  .stats-grid,
  .charts-grid,
  .top-holders-grid {
    grid-template-columns: 1fr;
  }

  .stat-content {
    grid-template-columns: 1fr;
  }

  .analysis-header h2 {
    font-size: 1.75rem;
  }

  .row-main {
    flex-direction: column;
    align-items: flex-start;
  }

  .positions-toggle {
    width: 100%;
  }

  .pool-wallet-summary {
    flex-direction: column;
  }
}

/* Ancres : marge de scroll pour que le titre reste visible quand on ouvre un lien avec # */
.analysis-view .analysis-header[id],
.analysis-view .section-header[id],
.analysis-view .historical-snapshots-section[id] {
  scroll-margin-top: 1.5rem;
}

.header-title-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.header-title-row h2,
.header-title-row-h3 h3 {
  margin: 0;
}

.copy-link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.25rem;
  height: 2.25rem;
  padding: 0 0.5rem;
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.copy-link-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--primary-color);
}

.copy-link-icon {
  font-size: 1rem;
  line-height: 1;
}

.copy-link-feedback {
  color: var(--success-color, #22c55e);
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}

.section-header {
  text-align: center;
  margin: 4rem 0 2.5rem;
  padding-top: 2rem;
  border-top: 1px solid var(--border-color);
}

.section-header h2 {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

.section-header p {
  color: var(--text-secondary);
}

.v2-card .stat-value {
  color: #8b5cf6; /* Violet */
}

.v3-card .stat-value {
  color: #ec4899; /* Pink */
}

.comparison-section {
  margin-bottom: 2.5rem;
}

.comparison-controls {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.comparison-select {
  flex: 1;
  min-width: 250px;
  padding: 0.75rem 1rem;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 0.95rem;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  font-weight: 500;
}

.comparison-select option {
  background: var(--card-bg);
  color: var(--text-primary);
  padding: 0.5rem;
}

.comparison-select:hover {
  border-color: var(--primary-color);
}

.comparison-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.comparison-select:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.btn-clear-comparison {
  padding: 0.75rem 1.25rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.3s ease;
}

.btn-clear-comparison:hover {
  background: var(--bg-secondary);
  border-color: var(--error-color);
  color: var(--error-color);
}

.comparison-results {
  animation: fadeIn 0.5s ease;
}

.comparison-card {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-color);
  border-radius: 1rem;
  padding: 2rem;
  box-shadow: var(--shadow-lg);
}

.comparison-card h3 {
  font-size: 1.5rem;
  margin-bottom: 1.5rem;
  color: var(--text-primary);
}

.comparison-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
}

.comparison-item {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.25rem;
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
}

.comparison-label {
  font-size: 0.9rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.comparison-values {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.comparison-current {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
}

.comparison-arrow {
  color: var(--text-secondary);
  font-size: 1.25rem;
}

.comparison-diff {
  font-size: 1.5rem;
  font-weight: 700;
  padding: 0.25rem 0.75rem;
  border-radius: 0.5rem;
}

.comparison-diff.positive {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
}

.comparison-diff.negative {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.comparison-reference {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: italic;
}

/* Address Search Section */
.address-search-section {
  margin: 2rem 0;
  padding: 2rem;
  background: var(--card-bg);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
}

.search-controls {
  margin-bottom: 2rem;
}

.search-input-group {
  display: flex;
  gap: 1rem;
  max-width: 600px;
  margin: 0 auto;
}

.search-input {
  flex: 1;
  padding: 0.875rem 1.25rem;
  font-size: 1rem;
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-family: 'Courier New', monospace;
  transition: all 0.3s ease;
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.search-btn {
  padding: 0.875rem 2rem;
  white-space: nowrap;
}

.search-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.address-results-container {
  margin-top: 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.address-evolution-chart {
  margin-top: 2rem;
  padding: 1.5rem;
  background: var(--card-bg, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-color);
  border-radius: 1rem;
  box-shadow: var(--shadow-lg);
}

.address-result-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  padding: 1rem;
  transition: all 0.3s ease;
}

.address-result-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.1);
}

.address-result-card.current-snapshot {
  border-color: var(--primary-color);
  background: rgba(99, 102, 241, 0.05);
}

.address-result-card.not-found {
  opacity: 0.6;
}

.result-main-row {
  display: grid;
  grid-template-columns: 150px repeat(4, 1fr) auto;
  gap: 1.5rem;
  align-items: center;
}

.result-col-snapshot {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.snapshot-date {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.snapshot-date-formatted {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.result-col-reg,
.result-col-power,
.result-col-pools,
.result-col-percentage {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.result-label {
  font-size: 0.7rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.result-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  font-family: 'Courier New', monospace;
}

.result-col-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: flex-end;
}

.btn-expand-details {
  padding: 0.375rem 0.75rem;
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  color: var(--primary-color);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 32px;
  text-align: center;
}

.btn-expand-details:hover {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

.result-details-row {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color);
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 1.5rem;
  align-items: center;
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    max-height: 0;
  }
  to {
    opacity: 1;
    max-height: 100px;
  }
}

.detail-item-compact {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.detail-label-compact {
  font-size: 0.7rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.detail-value-compact {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  font-family: 'Courier New', monospace;
}

.current-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  background: var(--primary-color);
  color: white;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.number-cell {
  font-family: 'Courier New', monospace;
  font-weight: 600;
  text-align: right;
}

.status-found {
  color: #10b981;
  font-weight: 600;
}

.status-not-found {
  color: var(--text-muted);
}

.no-results {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .comparison-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .comparison-select {
    min-width: 100%;
  }

  .comparison-grid {
    grid-template-columns: 1fr;
  }

  .search-input-group {
    flex-direction: column;
  }

  .search-btn {
    width: 100%;
  }

  .result-main-row {
    grid-template-columns: 120px repeat(2, 1fr) auto;
    gap: 1rem;
    font-size: 0.875rem;
  }

  .result-col-pools,
  .result-col-percentage {
    display: none;
  }

  .result-details-row {
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }
}

/* Snapshots Comparison Table */
.snapshots-table-container {
  margin-top: 2rem;
  margin-bottom: 3rem;
}

.snapshots-table {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-color);
  border-radius: 1rem;
  padding: 1.5rem;
  box-shadow: var(--shadow-lg);
}

.snapshot-row {
  display: flex;
  flex-direction: column;
  padding: 1.25rem 1rem;
  border-bottom: 1px solid var(--border-color);
  transition: background-color 0.2s ease;
}

.snapshot-row-main {
  display: grid;
  grid-template-columns: 200px repeat(3, 1fr) auto;
  gap: 2rem;
  align-items: center;
}

.snapshot-row:last-child {
  border-bottom: none;
}

.snapshot-row:hover {
  background: var(--glass-bg);
}

.snapshot-row.current-snapshot-row {
  background: rgba(74, 144, 226, 0.1);
  border-left: 3px solid var(--primary-color);
}

.snapshot-date-col {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.snapshot-date {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 1rem;
}

.snapshot-date-formatted {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.snapshot-stat-col {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.stat-icon {
  font-size: 1.25rem;
}

.stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
  font-family: 'Courier New', monospace;
  min-width: 120px;
}

.stat-diff {
  font-size: 0.875rem;
  font-weight: 600;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  font-family: 'Courier New', monospace;
}

.stat-diff.positive {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}

.stat-diff.negative {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.snapshot-details-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-expand-snapshot {
  padding: 0.5rem;
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  color: var(--primary-color);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 32px;
  text-align: center;
  line-height: 1;
}

.btn-expand-snapshot:hover {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

.snapshot-details-dropdown {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
  animation: slideDown 0.3s ease;
}

.pool-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
  padding: 1rem;
  background: var(--glass-bg);
  border-radius: 0.5rem;
}

.pool-metric-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pool-metric-item .metric-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.pool-metric-item .metric-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  font-family: 'Courier New', monospace;
}

.metric-hint {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-style: italic;
}

.concentration-item {
  grid-column: span 2;
}

.concentration-header {
  margin-bottom: 0.5rem;
}

.concentration-explanation-inline {
  font-size: 0.65rem;
  color: var(--text-muted);
  font-style: italic;
  font-weight: normal;
  margin-left: 0.5rem;
}

.concentration-values {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.concentration-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.concentration-row:last-child {
  border-bottom: none;
}

.concentration-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.concentration-value {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--primary-color);
  font-family: 'Courier New', monospace;
}

@media (max-width: 1024px) {
  .snapshot-row-main {
    grid-template-columns: 150px repeat(3, 1fr) auto;
    gap: 1rem;
  }
  
  .stat-value {
    font-size: 0.95rem;
    min-width: 100px;
  }
  
  .pool-metrics-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }
}

@media (max-width: 768px) {
  .snapshot-row-main {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  
  .snapshot-date-col {
    margin-bottom: 0.5rem;
  }
  
  .snapshot-stat-col {
    justify-content: space-between;
  }
  
  .pool-metrics-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}

/* Snapshots historiques section (from UploadView) */
.historical-snapshots-section {
  margin: 3rem 0;
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 2rem;
  box-shadow: var(--shadow-lg);
}

.historical-snapshots-header {
  text-align: center;
  margin-bottom: 2rem;
}

.historical-snapshots-header h3 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

.historical-snapshots-header p {
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.historical-snapshots-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.historical-snapshot-row {
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

.historical-snapshot-row:hover:not(:disabled) {
  border-color: var(--primary-color);
  background: var(--bg-tertiary);
  transform: translateX(4px);
  box-shadow: var(--shadow-md);
}

.historical-snapshot-row:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.historical-snapshot-row.historical-current-snapshot-row {
  border-color: var(--primary-color);
  background: rgba(99, 102, 241, 0.1);
  cursor: default;
}

.historical-snapshot-date-col {
  display: flex;
  align-items: center;
}

.historical-snapshot-date {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 1rem;
}

.historical-snapshot-metrics-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
  align-items: center;
}

.historical-snapshot-metric-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.historical-metric-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.historical-metric-content {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
}

.historical-metric-value-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.historical-metric-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.historical-metric-diff {
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 0.25rem;
  line-height: 1.2;
}

.historical-metric-diff.positive {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
}

.historical-metric-diff.negative {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.historical-metric-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.historical-snapshot-files {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.historical-snapshot-file {
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-family: 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .historical-snapshot-row {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .historical-snapshot-metrics-row {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}

/* Power Concentration Section */
.concentration-section {
  margin: 3rem 0;
}

.gini-card {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1));
  border-color: rgba(99, 102, 241, 0.3);
}

.gini-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--primary-color);
}

.gini-interpretation {
  font-weight: 600;
}

.concentration-table-card {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 2rem;
  margin: 2rem 0;
  box-shadow: var(--shadow-lg);
}

.concentration-table-card h3 {
  font-size: 1.25rem;
  margin-bottom: 1.5rem;
  color: var(--text-primary);
}

.concentration-table {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.concentration-table-header {
  display: grid;
  grid-template-columns: 1fr 1fr 1.5fr 1fr;
  gap: 1rem;
  padding: 1rem;
  background: var(--glass-bg);
  border-radius: 0.5rem;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 2px solid var(--border-color);
}

.concentration-table-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1.5fr 1fr;
  gap: 1rem;
  padding: 1rem;
  background: var(--glass-bg);
  border-radius: 0.5rem;
  transition: all 0.3s ease;
}

.concentration-table-row:hover {
  background: var(--bg-tertiary);
  transform: translateX(4px);
}

.concentration-col {
  color: var(--text-primary);
  display: flex;
  align-items: center;
}

.percentile-col {
  font-weight: 600;
  color: var(--primary-color);
}

.percentage-col {
  font-weight: 700;
  color: var(--accent-color);
  font-size: 1.1rem;
}

@media (max-width: 768px) {
  .concentration-table-header,
  .concentration-table-row {
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }

  .concentration-table-header {
    display: none;
  }

  .concentration-table-row {
    padding: 1rem;
  }

  .concentration-col {
    justify-content: space-between;
    padding: 0.25rem 0;
  }

  .concentration-col::before {
    content: attr(data-label);
    font-weight: 600;
    color: var(--text-secondary);
    margin-right: 1rem;
  }
}

/* Comparaison top holders Power Voting */
.top-holders-comparison-section {
  margin: 3rem 0;
}

.top-holders-table-card {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 2rem;
  margin: 2rem 0;
  box-shadow: var(--shadow-lg);
}

.top-holders-loading,
.top-holders-no-prev {
  color: var(--text-secondary);
  margin: 0;
}

.top-holders-table-wrapper {
  overflow-x: auto;
}

.top-holders-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}

.top-holders-table th,
.top-holders-table td {
  padding: 0.75rem 1rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.top-holders-table thead th {
  font-weight: 600;
  color: var(--text-primary);
  background: var(--glass-bg);
}

.top-holders-col-rank {
  width: 4rem;
  text-align: center;
}

.top-holders-col-address {
  min-width: 320px;
  word-break: break-all;
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
}

.top-holders-address-text {
  display: inline;
}

.top-holders-col-power {
  white-space: nowrap;
}

.top-holders-col-pct,
.top-holders-col-place,
.top-holders-col-pctdiff {
  white-space: nowrap;
  text-align: right;
}

.top-holders-row:hover {
  background: var(--bg-tertiary);
}

.top-holders-positive {
  color: var(--success-color, #22c55e);
  font-weight: 600;
}

.top-holders-negative {
  color: var(--danger-color, #ef4444);
  font-weight: 600;
}

.top-holders-charts-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 2rem;
  margin-top: 2rem;
}

.top-holders-chart-card {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 1.5rem;
  box-shadow: var(--shadow-lg);
}

.top-holders-chart-title {
  font-size: 1.1rem;
  margin: 0 0 1rem 0;
  color: var(--text-primary);
}

.top-holders-chart-container {
  position: relative;
  height: 520px;
}

@media (max-width: 968px) {
  .top-holders-charts-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .top-holders-table-card {
    padding: 1rem;
  }

  .top-holders-col-address {
    min-width: 180px;
    max-width: 240px;
    font-size: 0.75rem;
  }

  .top-holders-chart-container {
    height: 420px;
  }
}

/* Ancien top 20 : rang actuel */
.previous-top20-card {
  margin-top: 2.5rem;
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 1.5rem 2rem;
  box-shadow: var(--shadow-lg);
}

.previous-top20-title {
  font-size: 1.15rem;
  margin: 0 0 0.5rem 0;
  color: var(--text-primary);
}

.previous-top20-desc {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0 0 1rem 0;
}

.previous-top20-table-wrapper {
  overflow-x: auto;
}

.previous-top20-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.previous-top20-table th,
.previous-top20-table td {
  padding: 0.6rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.previous-top20-table thead th {
  font-weight: 600;
  color: var(--text-primary);
  background: var(--glass-bg);
}

.previous-top20-col-rank {
  width: 5rem;
  text-align: center;
}

.previous-top20-col-address {
  min-width: 260px;
  word-break: break-all;
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
}

.previous-top20-address-text {
  display: inline;
}

.previous-top20-col-current {
  width: 6rem;
  text-align: center;
}

.previous-top20-col-evol {
  width: 10rem;
  text-align: right;
  white-space: nowrap;
}

.previous-top20-col-pctdiff {
  width: 8rem;
  text-align: right;
  white-space: nowrap;
}

.previous-top20-row:hover {
  background: var(--bg-tertiary);
}

/* Évolution adresse par snapshot (recherche d'adresse) */
.address-evolution-table-wrapper {
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.address-evolution-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.address-evolution-table th,
.address-evolution-table td {
  padding: 0.6rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.address-evolution-table thead th {
  font-weight: 600;
  color: var(--text-primary);
  background: var(--glass-bg);
}

.addr-evol-col-date {
  min-width: 120px;
}

.addr-evol-col-rank {
  width: 5rem;
  text-align: center;
}

.addr-evol-col-power {
  min-width: 7rem;
  text-align: right;
}

.addr-evol-col-evol,
.addr-evol-col-pct,
.addr-evol-col-pctdiff {
  text-align: right;
  white-space: nowrap;
}

.addr-evol-col-pct {
  min-width: 6rem;
}

.addr-evol-col-pctdiff {
  min-width: 6rem;
}

.address-evolution-row:hover {
  background: var(--bg-tertiary);
}

.address-evolution-row.address-evolution-current {
  background: rgba(255, 140, 66, 0.08);
  font-weight: 500;
}
</style>
