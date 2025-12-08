<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
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

const router = useRouter()
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

const formatNumber = (num: number) => {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}

const formatInteger = (num: number) => {
  return new Intl.NumberFormat('fr-FR').format(Math.round(num))
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
    const key = pos.poolAddress || `${pos.dex}-${pos.poolType}`
    if (!poolsMap.has(key)) {
      poolsMap.set(key, { positions: [], totalREG: 0, poolType: pos.poolType })
    }
    const pool = poolsMap.get(key)!
    pool.positions.push(pos)
    pool.totalREG += pos.regAmount
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
        label: 'Multiplicateur moyen global V2',
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
        label: 'Multiplicateur moyen global V3',
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
</script>

<template>
  <div class="analysis-view" v-if="dataStore.balances.length > 0">
    <div class="analysis-header">
      <h2>📊 Analyse des données</h2>
      <p>Exploration et visualisation des balances REG et du pouvoir de vote</p>
    </div>

    <!-- Statistics Cards -->
    <div class="stats-grid">
      <div class="stat-card balance-card">
        <div class="stat-header">
          <h3>💰 Balances REG</h3>
        </div>
        <div class="stat-content" v-if="dataStore.balanceStats">
          <div class="stat-item">
            <span class="stat-label">Total</span>
            <span class="stat-value">{{ formatNumber(dataStore.balanceStats.total) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Moyenne</span>
            <span class="stat-value">{{ formatNumber(dataStore.balanceStats.mean) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Médiane</span>
            <span class="stat-value">{{ formatNumber(dataStore.balanceStats.median) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Min / Max</span>
            <span class="stat-value">
              {{ formatNumber(dataStore.balanceStats.min) }} /
              {{ formatNumber(dataStore.balanceStats.max) }}
            </span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Écart-type</span>
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
          <h3>⚡ Power Voting</h3>
        </div>
        <div class="stat-content" v-if="dataStore.powerVotingStats">
          <div class="stat-item">
            <span class="stat-label">Total</span>
            <span class="stat-value">{{ formatNumber(dataStore.powerVotingStats.total) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Moyenne</span>
            <span class="stat-value">{{ formatNumber(dataStore.powerVotingStats.mean) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Médiane</span>
            <span class="stat-value">{{ formatNumber(dataStore.powerVotingStats.median) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Min / Max</span>
            <span class="stat-value">
              {{ formatNumber(dataStore.powerVotingStats.min) }} /
              {{ formatNumber(dataStore.powerVotingStats.max) }}
            </span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Écart-type</span>
            <span class="stat-value">{{ formatNumber(dataStore.powerVotingStats.stdDev) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Nb adresses</span>
            <span class="stat-value">{{ dataStore.powerVotingStats.count }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts-grid">
      <div class="chart-card">
        <h3>📈 Distribution des Balances REG par adresse</h3>
        <div class="chart-container" v-if="balanceDistributionChartData">
          <Bar :data="balanceDistributionChartData" :options="countChartOptions" />
        </div>
      </div>

      <div class="chart-card">
        <h3>📊 Distribution du Power Voting par adresse</h3>
        <div class="chart-container" v-if="powerVotingDistributionChartData">
          <Bar :data="powerVotingDistributionChartData" :options="countChartOptions" />
        </div>
      </div>
    </div>

    <p class="chart-note" v-if="balanceDistributionChartData">
      Chaque barre représente une tranche de balances REG (axe horizontal). La hauteur de la barre
      indique combien de wallets se situent dans cette tranche (axe vertical). Exemple : « 100‑500 »
      signifie “4 845 wallets détiennent entre 100 et 500 REG équivalents”.
    </p>

    <!-- Pools Analysis Section -->
    <div class="section-header">
      <h2>🌊 Analyse Pools V2 & V3</h2>
      <p>Répartition de la liquidité et impact sur le Power Voting</p>
    </div>

    <div class="stats-grid" v-if="dataStore.poolAnalysis">
      <div class="stat-card v2-card">
        <div class="stat-header">
          <h3>💧 Pools V2</h3>
        </div>
        <div class="stat-content">
          <div class="stat-item">
            <span class="stat-label">Total REG</span>
            <span class="stat-value">{{ formatNumber(dataStore.poolAnalysis.v2.totalREG) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Nb Positions</span>
            <span class="stat-value">{{ dataStore.poolAnalysis.v2.count }}</span>
          </div>
        </div>
      </div>

      <div class="stat-card v3-card">
        <div class="stat-header">
          <h3>🦄 Pools V3</h3>
        </div>
        <div class="stat-content">
          <div class="stat-item">
            <span class="stat-label">Total REG</span>
            <span class="stat-value">{{ formatNumber(dataStore.poolAnalysis.v3.totalREG) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Nb Positions</span>
            <span class="stat-value">{{ dataStore.poolAnalysis.v3.count }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <h3>🥧 Répartition V2 vs V3</h3>
        <div class="chart-container" v-if="poolsDistributionChartData">
          <Doughnut :data="poolsDistributionChartData" :options="chartOptions" />
        </div>
      </div>

      <div class="chart-card">
        <h3>🏦 Répartition par DEX</h3>
        <div class="chart-container" v-if="dexsDistributionChartData">
          <Bar :data="dexsDistributionChartData" :options="chartOptions" />
        </div>
      </div>
    </div>

    <div class="section-header">
      <h2>🔗 Corrélation Pools & Power Voting</h2>
      <p>
        Les courbes comparent désormais des ratios (Power ÷ REG en pool) à la ligne 1 : 1, ce qui
        permet de visualiser instantanément si une position LP surperforme ou non le boost attendu.
      </p>
    </div>

    <div class="charts-grid correlation-grid">
      <div class="chart-card full-width">
        <h3>📉 Efficacité des positions LP : Multiplicateurs Power ÷ REG par adresse</h3>
        <div class="chart-container" v-if="poolPowerChartData">
          <Line :data="poolPowerChartData" :options="poolPowerChartOptions" />
        </div>
        <div class="chart-empty" v-else>
          <p>Aucune adresse active en pool n'a été détectée.</p>
        </div>
      </div>
    </div>

    <div class="chart-explainer">
      <p>
        Cette visualisation trace les ratios de boost pour les <strong>30 plus gros wallets utilisant des DEX V2 et V3</strong> :
        <strong>Boost pools</strong> (power réellement issu des pools ÷ REG en pool),
        <strong>Power total ÷ REG total</strong> (power total ÷ (REG wallet + REG en pool)) par rapport à la
        <strong>ligne de référence 1 : 1</strong>. Lorsque les courbes bleue ou rose passent
        <em>au-dessus</em> de 1 : 1, cela signifie qu'une adresse obtient plus de pouvoir de vote
        que sa simple mise en REG (boost). Si elles sont <em>en dessous</em>, la position est moins
        efficace qu’un dépôt direct (décote / inéligibilité partielle). Les adresses sont triées par
        liquidité décroissante pour faciliter la comparaison.
      </p>
      <p class="axis-note">
        L'axe vertical (à gauche) représente ce multiplicateur (1x = parité parfaite).
        <strong>Lignes bleues (pleines et pointillées)</strong> : multiplicateurs pour les wallets V2 (boost pools et moyen global).
        <strong>Lignes vertes/roses (pleines et pointillées)</strong> : multiplicateurs pour les wallets V3 (boost pools et moyen global).
        Au-dessus de 1x → boost, en dessous → performance réduite.
      </p>
      <p class="axis-note">
        <strong>Note</strong> : Seuls les wallets avec des positions LP actives sont affichés. Les 30 plus gros wallets de chaque catégorie (V2 et V3) sont représentés pour visualiser le niveau de boost apporté par le LP REG.
      </p>
    </div>

    <div class="pool-wallet-summary" v-if="dataStore.poolWalletBreakdown">
      <div class="summary-item">
        <span class="summary-label">Wallets V2</span>
        <span class="summary-value">{{ formatInteger(dataStore.poolWalletBreakdown.v2Wallets) }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Wallets V3</span>
        <span class="summary-value">{{ formatInteger(dataStore.poolWalletBreakdown.v3Wallets) }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Wallets V2 &amp; V3</span>
        <span class="summary-value">{{ formatInteger(dataStore.poolWalletBreakdown.both) }}</span>
      </div>
    </div>

    <div class="multiplier-info" style="margin: 1.5rem 0; padding: 1rem; background: var(--card-bg, rgba(255, 255, 255, 0.05)); border-radius: 8px; border-left: 3px solid var(--primary-color, #4a90e2);">
      <p style="margin: 0 0 0.75rem 0; font-weight: 600; color: var(--text-primary); font-size: 0.9rem;">
        BETA Les multiplicateurs :
      </p>
      <ul style="margin: 0; padding-left: 1.5rem; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.6;">
        <li><strong>Sushiswap V2</strong> : ×1.5</li>
        <li><strong>Honeyswap V2</strong> : ×1.3</li>
        <li><strong>Balancer V2</strong> : ×1.4</li>
        <li><strong>Sushiswap V3 actif</strong> : ×2.5</li>
        <li><strong>Sushiswap V3 inactif</strong> : ×1</li>
      </ul>
    </div>

    <div
      class="correlation-table"
      v-if="chartWallets && chartWallets.length > 0"
    >
      <div
        class="correlation-row"
        v-for="profile in chartWallets"
        :key="profile.address"
      >
        <div class="row-main">
          <div class="address-block">
            <span class="address-short">{{ formatAddress(profile.address) }}</span>
            <span class="address-full">{{ profile.address }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Liquidité en pools</span>
            <span class="metric-value">{{ formatNumber(profile.poolLiquidityREG) }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Power total</span>
            <span class="metric-value">{{ formatNumber(profile.powerVoting) }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Boost vs 1:1</span>
            <span class="metric-value">
              {{ getAveragePoolMultiplier(profile) ? getAveragePoolMultiplier(profile).toFixed(2) + 'x' : '–' }}
            </span>
          </div>
          <div class="metric positions-count">
            <span class="metric-label">Positions</span>
            <div class="metric-value" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span>{{ profile.positions.length }}</span>
              <div v-if="getPositionCounts(profile).v2 > 0 || getPositionCounts(profile).v3 > 0" class="position-type-breakdown" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <span v-if="getPositionCounts(profile).v2 > 0" class="position-badge position-badge-v2" style="display: inline-flex; align-items: center; padding: 0.25rem 0.5rem; background: rgba(74, 144, 226, 0.15); border: 1px solid rgba(74, 144, 226, 0.3); border-radius: 0.375rem; font-size: 0.75rem; font-weight: 600; color: #60a5fa;">
                  V2: {{ getPositionCounts(profile).v2 }}
                </span>
                <span v-if="getPositionCounts(profile).v3 > 0" class="position-badge position-badge-v3" style="display: inline-flex; align-items: center; padding: 0.25rem 0.5rem; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 0.375rem; font-size: 0.75rem; font-weight: 600; color: #4ade80;">
                  V3: {{ getPositionCounts(profile).v3 }}
                </span>
              </div>
            </div>
          </div>
          <button
            class="positions-toggle"
            @click="toggleWalletPositions(profile.address)"
          >
            {{ isWalletExpanded(profile.address) ? 'Masquer les détails' : 'Afficher les détails' }}
          </button>
        </div>
        <div class="row-details" v-if="isWalletExpanded(profile.address)">
          <div class="detail-metrics">
            <div class="metric">
              <span class="metric-label">Power (attribué pools)</span>
              <span class="metric-value">
                {{ formatNumber(profile.poolVotingShare) }}
                <span v-if="getPowerByPoolType(profile).v2 > 0 || getPowerByPoolType(profile).v3 > 0" class="power-type-breakdown" style="display: block; font-size: 0.75em; color: var(--text-secondary); margin-top: 0.25rem;">
                  V2: {{ formatNumber(getPowerByPoolType(profile).v2) }}, V3: {{ formatNumber(getPowerByPoolType(profile).v3) }}
                </span>
              </span>
            </div>
            <div class="metric">
              <span class="metric-label">Wallet hors pools</span>
              <span class="metric-value">{{ formatNumber(profile.walletDirectREG) }}</span>
            </div>
          </div>
          <div class="positions-list">
            <div
              class="position-pill"
              :class="{
                'position-active': position.poolType === 'v3' && isPositionActive(position) === true,
                'position-inactive': position.poolType === 'v3' && isPositionActive(position) === false
              }"
              v-for="position in profile.positions"
              :key="`${profile.address}-${position.poolAddress || 'pool'}-${position.dex}-${position.regAmount}`"
            >
              <div class="position-pill-header">
              <span class="pill-dex">{{ position.dex }} • {{ position.poolType.toUpperCase() }}</span>
              <span class="pill-pool">
                {{ position.poolAddress ? formatAddress(position.poolAddress) : 'N/A' }}
              </span>
              </div>
              <div class="position-pill-details">
              <span class="pill-value">{{ formatNumber(position.regAmount) }} REG</span>
                <span class="pill-power" v-if="getPositionPowerAndMultiplier(position, profile).power > 0">
                  Power: {{ formatNumber(getPositionPowerAndMultiplier(position, profile).power) }}
                </span>
                <span class="pill-multiplier" v-if="getPositionPowerAndMultiplier(position, profile).multiplier > 0">
                  ×{{ getPositionPowerAndMultiplier(position, profile).multiplier.toFixed(2) }}
                </span>
            </div>
          </div>
        </div>
      </div>
    </div>

      <div v-if="addressSearchResults.length === 0 && !isSearchingAddress && searchAddress.trim()" class="no-results">
        <p>Aucun résultat trouvé pour cette adresse.</p>
      </div>
    </div>

    <!-- Address Search Across Snapshots -->
    <div class="section-header">
      <h2>🔍 Recherche d'adresse sur tous les snapshots</h2>
      <p>Analysez l'évolution d'une adresse sur tous les snapshots historiques</p>
    </div>

    <div class="address-search-section">
      <div class="search-controls">
        <div class="search-input-group">
          <input
            v-model="searchAddress"
            @keyup.enter="searchAddressAcrossSnapshots"
            type="text"
            placeholder="Entrez une adresse (0x...)"
            class="search-input"
          />
        <button
            @click="searchAddressAcrossSnapshots"
            :disabled="isSearchingAddress || !searchAddress.trim()"
            class="btn btn-primary search-btn"
        >
            {{ isSearchingAddress ? 'Recherche...' : 'Rechercher' }}
        </button>
        </div>
      </div>

      <div v-if="addressSearchResults.length > 0" class="address-results-container">
        <div
          v-for="result in addressSearchResults"
          :key="result.date"
          class="address-result-card"
          :class="{ 'current-snapshot': result.isCurrent, 'not-found': !result.found }"
        >
          <!-- Ligne principale -->
          <div class="result-main-row">
            <div class="result-col-snapshot">
              <span v-if="result.isCurrent" class="current-badge">Actuel</span>
              <span v-else class="snapshot-date">{{ result.date }}</span>
              <span class="snapshot-date-formatted">{{ result.dateFormatted }}</span>
              </div>

            <div class="result-col-reg">
              <span class="result-label">REG Total</span>
              <span class="result-value">{{ result.found ? formatNumber(result.reg) : '–' }}</span>
              </div>

            <div class="result-col-power">
              <span class="result-label">Power Voting</span>
              <span class="result-value">{{ result.found ? formatNumber(result.powerVoting) : '–' }}</span>
            </div>

            <div class="result-col-pools" v-if="result.poolAnalysis">
              <span class="result-label">Nb Pools</span>
              <span class="result-value">{{ formatInteger(result.poolAnalysis.totalPools) }}</span>
              </div>

            <div class="result-col-percentage" v-if="result.poolAnalysis">
              <span class="result-label">% REG en Pools</span>
              <span class="result-value">{{ formatNumber(result.poolAnalysis.poolRegPercentage) }}%</span>
            </div>

            <div class="result-col-status">
              <span v-if="result.found" class="status-found">✓</span>
              <span v-else class="status-not-found">✗</span>
              <button
                v-if="result.found && result.poolAnalysis"
                @click="toggleAddressResultDetails(result.date)"
                class="btn-expand-details"
              >
                {{ isAddressResultExpanded(result.date) ? '▼' : '▶' }}
              </button>
              </div>
            </div>

          <!-- Ligne détaillée (expandable) -->
          <div
            v-if="isAddressResultExpanded(result.date) && result.poolAnalysis"
            class="result-details-row"
          >
            <div class="detail-item-compact">
              <span class="detail-label-compact">REG en Pools</span>
              <span class="detail-value-compact">{{ formatNumber(result.poolAnalysis.regInPools) }}</span>
              </div>
            <div class="detail-item-compact">
              <span class="detail-label-compact">In Range</span>
              <span class="detail-value-compact">{{ formatInteger(result.poolAnalysis.poolsInRange) }} pools / {{ formatNumber(result.poolAnalysis.regInRange) }} REG</span>
              </div>
            <div class="detail-item-compact">
              <span class="detail-label-compact">Out Range</span>
              <span class="detail-value-compact">{{ formatInteger(result.poolAnalysis.poolsOutOfRange) }} pools / {{ formatNumber(result.poolAnalysis.regOutOfRange) }} REG</span>
            </div>
            <div class="detail-item-compact">
              <span class="detail-label-compact">V2 / V3</span>
              <span class="detail-value-compact">{{ formatInteger(result.poolAnalysis.v2Pools) }} / {{ formatInteger(result.poolAnalysis.v3Pools) }}</span>
            </div>
            <div class="detail-item-compact">
              <span class="detail-label-compact">DEX</span>
              <span class="detail-value-compact">{{ formatInteger(result.poolAnalysis.dexCount) }}</span>
          </div>
        </div>
        </div>
      </div>

      <!-- Graphique d'évolution -->
      <div v-if="addressSearchResults.length > 0 && addressSearchResults.some(r => r.found)" class="address-evolution-chart">
        <h3 style="margin-bottom: 1.5rem; color: var(--text-primary); font-weight: 600;">📈 Évolution de l'adresse {{ formatAddress(searchAddress) }}</h3>
        <Line
          :data="addressEvolutionChartData"
          :options="addressEvolutionChartOptions"
          style="max-height: 400px;"
        />
      </div>
    </div>

    <!-- Top Holders -->
    <div class="top-holders-section">
      <h2 class="top-holders-title">Listes des meilleurs adresses</h2>
    <div class="top-holders-grid">
      <div class="top-card">
        <h3>🏆 Top 10 Balances REG</h3>
        <div class="top-list">
          <div
            v-for="(holder, index) in dataStore.topBalanceHolders"
            :key="holder.address"
            class="top-item"
          >
            <span class="rank">{{ index + 1 }}</span>
              <span class="address" @click="copyAddress(holder.address)" :title="holder.address">
                {{ formatAddress(holder.address) }}
              </span>
            <span class="value">{{ formatNumber(holder.balance) }}</span>
              <button
                @click="copyAddress(holder.address)"
                class="btn-copy-address"
                :title="`Copier ${holder.address}`"
              >
                📋
              </button>
          </div>
        </div>
      </div>

      <div class="top-card">
        <h3>⚡ Top 10 Power Voting</h3>
        <div class="top-list">
          <div
            v-for="(voter, index) in dataStore.topPowerVoters"
            :key="voter.address"
            class="top-item"
          >
            <span class="rank">{{ index + 1 }}</span>
              <span class="address" @click="copyAddress(voter.address)" :title="voter.address">
                {{ formatAddress(voter.address) }}
              </span>
            <span class="value">{{ formatNumber(voter.power) }}</span>
              <button
                @click="copyAddress(voter.address)"
                class="btn-copy-address"
                :title="`Copier ${voter.address}`"
              >
                📋
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Snapshots Comparison Table -->
    <div class="section-header" style="margin-top: 4rem;">
      <h2>📸 Snapshots historiques ({{ snapshotStats.length }})</h2>
      <p>Comparaison de tous les snapshots disponibles, y compris le snapshot actuel</p>
    </div>

    <div class="snapshots-table-container">
      <div class="snapshots-table">
        <div
          v-for="(stat, index) in snapshotStats"
          :key="stat.date"
          class="snapshot-row"
          :class="{ 'current-snapshot-row': stat.isCurrent }"
        >
          <div class="snapshot-row-main">
            <div class="snapshot-date-col">
              <span v-if="stat.isCurrent" class="current-badge">Actuel</span>
              <span v-else class="snapshot-date">{{ stat.date }}</span>
              <span v-if="!stat.isCurrent" class="snapshot-date-formatted">{{ stat.dateFormatted }}</span>
            </div>
            
            <div class="snapshot-stat-col">
            <span class="stat-icon">👥</span>
            <span class="stat-value">{{ formatInteger(stat.wallets) }}</span>
            <span v-if="stat.walletsDiff !== undefined" class="stat-diff" :class="{ 'positive': stat.walletsDiff > 0, 'negative': stat.walletsDiff < 0 }">
              {{ stat.walletsDiff > 0 ? '+' : '' }}{{ formatInteger(stat.walletsDiff) }}
            </span>
              <span class="stat-label">wallets</span>
            </div>
            
            <div class="snapshot-stat-col">
              <span class="stat-icon">💰</span>
              <span class="stat-value">{{ formatNumber(stat.reg) }}</span>
              <span v-if="stat.regDiff !== undefined" class="stat-diff" :class="{ 'positive': stat.regDiff > 0, 'negative': stat.regDiff < 0 }">
                {{ stat.regDiff > 0 ? '+' : '' }}{{ formatNumber(stat.regDiff) }}
              </span>
              <span class="stat-label">REG</span>
            </div>
            
            <div class="snapshot-stat-col">
              <span class="stat-icon">⚡</span>
              <span class="stat-value">{{ formatNumber(stat.power) }}</span>
              <span v-if="stat.powerDiff !== undefined" class="stat-diff" :class="{ 'positive': stat.powerDiff > 0, 'negative': stat.powerDiff < 0 }">
                {{ stat.powerDiff > 0 ? '+' : '' }}{{ formatNumber(stat.powerDiff) }}
              </span>
              <span class="stat-label">Power</span>
            </div>
            
            <div class="snapshot-details-toggle">
              <button
                @click="toggleSnapshotDetails(stat.date)"
                class="btn-expand-snapshot"
                :title="isSnapshotExpanded(stat.date) ? 'Masquer les détails' : 'Afficher les détails'"
              >
                {{ isSnapshotExpanded(stat.date) ? '▼' : '▶' }}
              </button>
            </div>
          </div>
          
          <!-- Dropdown avec les métriques détaillées -->
          <div
            v-if="isSnapshotExpanded(stat.date) && stat.poolMetrics"
            class="snapshot-details-dropdown"
          >
            <div class="pool-metrics-grid">
              <div class="pool-metric-item">
                <span class="metric-label">Pools V2</span>
                <span class="metric-value">{{ formatInteger(stat.poolMetrics.v2Pools) }}</span>
              </div>
              <div class="pool-metric-item">
                <span class="metric-label">Pools V3</span>
                <span class="metric-value">
                  {{ stat.poolMetrics.v3DataAvailable === false ? 'N/A' : formatInteger(stat.poolMetrics.v3Pools) }}
                </span>
              </div>
              <div class="pool-metric-item">
                <span class="metric-label">V3 Actives</span>
                <span class="metric-value">
                  {{ stat.poolMetrics.v3DataAvailable === false ? 'N/A' : formatInteger(stat.poolMetrics.v3Active) }}
                </span>
              </div>
              <div class="pool-metric-item">
                <span class="metric-label">V3 Inactives</span>
                <span class="metric-value">
                  {{ stat.poolMetrics.v3DataAvailable === false ? 'N/A' : formatInteger(stat.poolMetrics.v3Inactive) }}
                </span>
              </div>
              <div class="pool-metric-item">
                <span class="metric-label">Wallets avec pools</span>
                <span class="metric-value">{{ formatInteger(stat.poolMetrics.walletsWithPools) }}</span>
              </div>
              <div class="pool-metric-item concentration-item">
                <div class="concentration-header">
                  <span class="metric-label">
                    Concentration Power
                    <span class="concentration-explanation-inline">
                      (Top X% détient Y% de la supply du power voting)
                    </span>
                  </span>
                </div>
                <div class="concentration-values">
                  <div class="concentration-row">
                    <span class="concentration-label">Top 10%:</span>
                    <span class="concentration-value">{{ formatNumber(stat.poolMetrics.powerConcentration.top10) }}%</span>
                  </div>
                  <div class="concentration-row">
                    <span class="concentration-label">Top 15%:</span>
                    <span class="concentration-value">{{ formatNumber(stat.poolMetrics.powerConcentration.top15) }}%</span>
                  </div>
                  <div class="concentration-row">
                    <span class="concentration-label">Top 20%:</span>
                    <span class="concentration-value">{{ formatNumber(stat.poolMetrics.powerConcentration.top20) }}%</span>
                  </div>
                  <div class="concentration-row">
                    <span class="concentration-label">Top 25%:</span>
                    <span class="concentration-value">{{ formatNumber(stat.poolMetrics.powerConcentration.top25) }}%</span>
                  </div>
                  <div class="concentration-row">
                    <span class="concentration-label">Top 50%:</span>
                    <span class="concentration-value">{{ formatNumber(stat.poolMetrics.powerConcentration.top50) }}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="no-data">
    <p>Aucune donnée disponible. Veuillez charger des fichiers.</p>
    <button @click="router.push('/')" class="btn btn-primary">Retour à l'upload</button>
  </div>
</template>

<style scoped>
.analysis-view {
  animation: fadeIn 0.5s ease;
}

.analysis-header {
  text-align: center;
  margin-bottom: 2.5rem;
}

.analysis-header h2 {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
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
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
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
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
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
</style>
