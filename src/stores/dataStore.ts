import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface BalanceData {
  walletAddress: string
  type: string
  totalBalanceREG: string | number
  totalBalanceEquivalentREG?: string | number
  [key: string]: any
}

export interface PowerVotingData {
  address: string
  powerVoting: string | number
}

export const useDataStore = defineStore('data', () => {
  const rawBalancesData = ref<any>(null)
  const rawPowerVotingData = ref<any>(null)

  const balances = computed<BalanceData[]>(() => {
    if (!rawBalancesData.value) return []

    // Handle both direct array and nested result structure
    const data = rawBalancesData.value.result?.balances || rawBalancesData.value
    return Array.isArray(data) ? data : []
  })

  /** Balances filtrées pour l’affichage “REG en wallet” (exclut les pools/contrats). */
  const walletBalances = computed<BalanceData[]>(() => {
    return balances.value.filter((b) => String(b.type || '') === 'wallet')
  })

  const powerVoting = computed<PowerVotingData[]>(() => {
    if (!rawPowerVotingData.value) return []

    // Handle both direct array and nested result structure
    const data = rawPowerVotingData.value.result?.powerVoting || rawPowerVotingData.value
    return Array.isArray(data) ? data : []
  })

  // Statistics
  const balanceStats = computed(() => {
    if (walletBalances.value.length === 0) return null

    const values = walletBalances.value
      .map((b) => parseFloat(String(b.totalBalanceREG || b.totalBalance || 0)))
      .filter((v) => !isNaN(v))

    if (values.length === 0) return null

    const sorted = [...values].sort((a, b) => a - b)
    const total = values.reduce((sum, val) => sum + val, 0)
    const mean = total / values.length

    const median =
      sorted.length % 2 === 0
        ? ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2
        : (sorted[Math.floor(sorted.length / 2)] ?? 0)

    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
    const stdDev = Math.sqrt(variance)

    return {
      count: values.length,
      total,
      mean,
      median,
      min: Math.min(...values),
      max: Math.max(...values),
      stdDev,
    }
  })

  const powerVotingStats = computed(() => {
    if (powerVoting.value.length === 0) return null

    const values = powerVoting.value
      .map((p) => parseFloat(String(p.powerVoting || 0)))
      .filter((v) => !isNaN(v))

    if (values.length === 0) return null

    const sorted = [...values].sort((a, b) => a - b)
    const total = values.reduce((sum, val) => sum + val, 0)
    const mean = total / values.length

    const median =
      sorted.length % 2 === 0
        ? ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2
        : (sorted[Math.floor(sorted.length / 2)] ?? 0)

    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
    const stdDev = Math.sqrt(variance)

    return {
      count: values.length,
      total,
      mean,
      median,
      min: Math.min(...values),
      max: Math.max(...values),
      stdDev,
    }
  })

  // Distribution data for charts
  const balanceDistribution = computed(() => {
    if (walletBalances.value.length === 0) return null

    const values = walletBalances.value
      .map((b) => parseFloat(String(b.totalBalanceREG || b.totalBalance || 0)))
      .filter((v) => !isNaN(v) && v > 0)

    if (values.length === 0) return null

    // Create bins
    const bins = [
      { label: '0-100', min: 0, max: 100, count: 0 },
      { label: '100-500', min: 100, max: 500, count: 0 },
      { label: '500-1000', min: 500, max: 1000, count: 0 },
      { label: '1000-5000', min: 1000, max: 5000, count: 0 },
      { label: '5000-10000', min: 5000, max: 10000, count: 0 },
      { label: '10000+', min: 10000, max: Infinity, count: 0 },
    ]

    values.forEach((value) => {
      const bin = bins.find((b) => value >= b.min && value < b.max)
      if (bin !== undefined) bin.count++
    })

    return bins
  })

  const powerVotingDistribution = computed(() => {
    if (powerVoting.value.length === 0) return null

    const values = powerVoting.value
      .map((p) => parseFloat(String(p.powerVoting || 0)))
      .filter((v) => !isNaN(v) && v > 0)

    if (values.length === 0) return null

    // Create bins
    const bins = [
      { label: '0-100', min: 0, max: 100, count: 0 },
      { label: '100-500', min: 100, max: 500, count: 0 },
      { label: '500-1000', min: 500, max: 1000, count: 0 },
      { label: '1000-5000', min: 1000, max: 5000, count: 0 },
      { label: '5000-10000', min: 5000, max: 10000, count: 0 },
      { label: '10000+', min: 10000, max: Infinity, count: 0 },
    ]

    values.forEach((value) => {
      const bin = bins.find((b) => value >= b.min && value < b.max)
      if (bin !== undefined) bin.count++
    })

    return bins
  })

  // Top holders
  const topBalanceHolders = computed(() => {
    if (walletBalances.value.length === 0) return []

    return [...walletBalances.value]
      .map((b) => ({
        address: b.walletAddress,
        balance: parseFloat(String(b.totalBalanceREG || b.totalBalance || 0)),
      }))
      .filter((item) => !isNaN(item.balance))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 10)
  })

  const topPowerVoters = computed(() => {
    if (powerVoting.value.length === 0) return []

    return [...powerVoting.value]
      .map((p) => ({
        address: p.address,
        power: parseFloat(String(p.powerVoting || 0)),
      }))
      .filter((item) => !isNaN(item.power))
      .sort((a, b) => b.power - a.power)
      .slice(0, 10)
  })

  const poolAnalysis = computed(() => {
    if (balances.value.length === 0) return null

    const v2Stats: PoolStats = { totalREG: 0, count: 0, dexs: {} }
    const v3Stats: PoolStats = { totalREG: 0, count: 0, dexs: {} }

    // Track unique pools found
    const pools = new Set<string>()

    balances.value.forEach(wallet => {
      // Check Gnosis chain (main focus based on data)
      const dexs = wallet.sourceBalance?.gnosis?.dexs
      if (!dexs) return

      Object.entries(dexs).forEach(([dexName, positions]: [string, any]) => {
        if (!Array.isArray(positions)) return

        positions.forEach((pos: PoolPosition) => {
          const regAmount = parseFloat(pos.equivalentREG || '0')
          if (regAmount <= 0) return

          // Determine if V3 or V2
          // Les pools V2 transformés ont tickLower: -887200 et tickUpper: 887200 (full range)
          // Les vrais pools V3 ont des ranges plus petits
          const tickLower = typeof pos.tickLower === 'number' ? pos.tickLower : parseFloat(String(pos.tickLower || 0))
          const tickUpper = typeof pos.tickUpper === 'number' ? pos.tickUpper : parseFloat(String(pos.tickUpper || 0))
          const isV2Transformed = tickLower === -887200 && tickUpper === 887200
          const isV3 = pos.tickLower !== undefined && pos.tickUpper !== undefined && !isV2Transformed

          if (isV3) {
            v3Stats.totalREG += regAmount
            v3Stats.count++
            v3Stats.dexs[dexName] = (v3Stats.dexs[dexName] || 0) + regAmount
          } else {
            // V2 (transformé ou original)
            v2Stats.totalREG += regAmount
            v2Stats.count++
            v2Stats.dexs[dexName] = (v2Stats.dexs[dexName] || 0) + regAmount
          }

          pools.add(pos.poolAddress)
        })
      })
    })

    return {
      v2: v2Stats,
      v3: v3Stats,
      totalPools: pools.size,
    }
  })

  const addressPoolProfiles = computed<AddressPoolProfile[]>(() => {
    if (balances.value.length === 0) return []

    return balances.value
      .map((wallet) => {
        const networks = wallet.sourceBalance
        if (!networks) return null

        const positions: AddressPoolPosition[] = []

        Object.entries(networks).forEach(([networkName, networkValue]: [string, any]) => {
          const dexs = networkValue?.dexs
          if (!dexs) return

        Object.entries(dexs).forEach(([dexName, rawPositions]: [string, any]) => {
          if (!Array.isArray(rawPositions)) return

          // Grouper les positions par positionId pour les pools V3 (qui ont 2 tokens par position)
          const positionsByPositionId = new Map<string, any[]>()
          const v2Positions: any[] = []
          
          rawPositions.forEach((pos: PoolPosition) => {
            const regAmount = parseFloat(String(pos.equivalentREG || '0'))
            
            // Détecter si c'est un V2 transformé (full range) ou un vrai V3
            const tickLower = typeof pos.tickLower === 'number' ? pos.tickLower : parseFloat(String(pos.tickLower || 0))
            const tickUpper = typeof pos.tickUpper === 'number' ? pos.tickUpper : parseFloat(String(pos.tickUpper || 0))
            const isV2Transformed = tickLower === -887200 && tickUpper === 887200
            const poolType: 'v2' | 'v3' =
              (pos.tickLower !== undefined && pos.tickUpper !== undefined && !isV2Transformed) ? 'v3' : 'v2'

            // Pour V3, grouper par positionId (une position = 2 tokens, même si un token a 0 REG)
            // Vérifier que positionId existe et n'est pas null/0
            const positionIdValue = pos.positionId !== undefined && pos.positionId !== null 
              ? (typeof pos.positionId === 'string' ? parseInt(pos.positionId, 10) : Number(pos.positionId))
              : null
            const hasPositionId = positionIdValue !== null && !isNaN(positionIdValue) && positionIdValue !== 0
            
            if (poolType === 'v3' && hasPositionId) {
              // Utiliser positionId + poolAddress comme clé pour éviter de regrouper des positions de pools différents
              const poolAddress = pos.poolAddress || 'unknown'
              const positionKey = `${positionIdValue}-${poolAddress}`
              if (!positionsByPositionId.has(positionKey)) {
                positionsByPositionId.set(positionKey, [])
              }
              positionsByPositionId.get(positionKey)!.push({
                ...pos,
                dex: dexName,
                network: networkName,
                poolType,
                regAmount,
              })
            } else {
              if (regAmount > 0) {
                v2Positions.push({
                  ...pos,
                  dex: dexName,
                  network: networkName,
                  poolType,
                  regAmount,
                })
              }
            }
          })

          // Pour les positions V3 groupées : comme develop, somme des regAmount (même calcul que develop pour la courbe)
          positionsByPositionId.forEach((tokens) => {
            if (tokens.length === 0) return

            const totalRegAmount = tokens.reduce((sum, token) => sum + token.regAmount, 0)
            if (totalRegAmount <= 0) return

            // Prendre la première entrée comme base (elle contient toutes les infos de la position)
            const basePos = tokens[0]
            
            // Trouver le token avec le plus de REG pour les infos d'affichage
            const mainToken = tokens.reduce((max, token) => 
              token.regAmount > max.regAmount ? token : max
            )

            // Agréger aussi les tokenBalance pour afficher le total si nécessaire
            const totalTokenBalance = tokens.reduce((sum, token) => {
              const balance = parseFloat(String(token.tokenBalance || '0'))
              return sum + balance
            }, 0)

            // Stocker les détails de tous les tokens pour l'affichage
            const tokenDetails = tokens
              .filter(token => parseFloat(String(token.tokenBalance || '0')) > 0)
              .map(token => ({
                tokenSymbol: token.tokenSymbol || 'UNKNOWN',
                tokenBalance: String(token.tokenBalance || '0'),
                equivalentREG: String(token.equivalentREG || '0'),
              }))

            positions.push({
              ...basePos,
              regAmount: totalRegAmount,
              // Utiliser les infos du token principal pour l'affichage, mais avec le total
              tokenBalance: totalTokenBalance > 0 ? totalTokenBalance.toString() : mainToken.tokenBalance,
              tokenSymbol: mainToken.tokenSymbol,
              equivalentREG: totalRegAmount.toString(),
              // Stocker les détails de tous les tokens
              tokens: tokenDetails.length > 0 ? tokenDetails : undefined,
            })
          })

          positions.push(...v2Positions)
        })
        })

        if (positions.length === 0) return null

        const totalLiquidity = positions.reduce((sum, pos) => sum + pos.regAmount, 0)
        const dexCount = new Set(positions.map((pos) => `${pos.network}-${pos.dex}`)).size

        // Total REG du snapshot (pour les graphiques uniquement). La search bar recalcule "REG en wallet" depuis les données brutes.
        const totalWalletREG = parseFloat(String(wallet.totalBalanceREG || wallet.totalBalance || 0)) || 0

        return {
          address: wallet.walletAddress,
          walletREG: totalWalletREG,
          poolLiquidityREG: totalLiquidity,
          poolCount: positions.length,
          dexCount,
          positions,
        }
      })
      .filter((profile): profile is AddressPoolProfile => profile !== null)
  })

  const poolPowerCorrelation = computed<PoolPowerCorrelation[]>(() => {
    if (addressPoolProfiles.value.length === 0 || powerVoting.value.length === 0) return []

    const powerMap = new Map(
      powerVoting.value.map((entry) => [
        (entry.address || '').toLowerCase(),
        parseFloat(String(entry.powerVoting || 0)),
      ]),
    )

    return addressPoolProfiles.value
      .map((profile) => {
        const powerValue = powerMap.get(profile.address.toLowerCase()) || 0
        const walletDirectREG = Math.max(profile.walletREG - profile.poolLiquidityREG, 0)
        const walletVotingShare = Math.min(powerValue, walletDirectREG)
        const poolVotingShare = Math.max(powerValue - walletDirectREG, 0)
        
        // Calculer le multiplicateur moyen pondéré des pools
        // En regroupant les positions par pool et en utilisant les multiplicateurs estimés
        const poolsMap = new Map<string, { totalREG: number, multiplier: number }>()
        
        profile.positions.forEach((pos: any) => {
          const poolKey = pos.poolAddress || `${pos.dex}-${pos.poolType}`
          if (!poolsMap.has(poolKey)) {
            // Estimation du multiplicateur basé sur le type de pool
            let estimatedMultiplier = 1.5 // V2 par défaut
            if (pos.poolType === 'v3') {
              estimatedMultiplier = pos.isActive === true ? 10 : 1 // V3 : boost 1–10 (modèle voté)
            } else if (pos.poolType === 'v2') {
              const dexName = (pos.dex || '').toLowerCase()
              if (dexName.includes('sushiswap')) {
                estimatedMultiplier = 1.5
              } else if (dexName.includes('honeyswap')) {
                estimatedMultiplier = 1.3
              } else if (dexName.includes('balancer')) {
                estimatedMultiplier = 1.4
              }
            }
            poolsMap.set(poolKey, { totalREG: 0, multiplier: estimatedMultiplier })
          }
          const pool = poolsMap.get(poolKey)!
          pool.totalREG += pos.regAmount
        })
        
        // Calculer le multiplicateur moyen pondéré
        let totalWeightedPower = 0
        poolsMap.forEach((pool) => {
          totalWeightedPower += pool.totalREG * pool.multiplier
        })
        
        // Le boostMultiplier est le multiplicateur moyen pondéré
        // Si poolVotingShare est disponible, on l'utilise pour un calcul plus précis
        const boostMultiplier = profile.poolLiquidityREG > 0 && poolVotingShare > 0
          ? poolVotingShare / profile.poolLiquidityREG
          : (profile.poolLiquidityREG > 0 
              ? totalWeightedPower / profile.poolLiquidityREG 
              : 0)

        return {
          ...profile,
          powerVoting: powerValue,
          walletDirectREG,
          walletVotingShare,
          poolVotingShare,
          boostMultiplier,
        }
      })
      .filter((item) => item.poolLiquidityREG > 0) // Inclure toutes les adresses avec des pools, même si powerVoting est 0
      .sort((a, b) => b.poolLiquidityREG - a.poolLiquidityREG)
  })

  const poolWalletBreakdown = computed(() => {
    if (addressPoolProfiles.value.length === 0) return null

    let v2Wallets = 0
    let v3Wallets = 0
    let both = 0

    addressPoolProfiles.value.forEach((profile) => {
      const hasV2 = profile.positions.some((position) => position.poolType === 'v2')
      const hasV3 = profile.positions.some((position) => position.poolType === 'v3')

      if (hasV2) v2Wallets++
      if (hasV3) v3Wallets++
      if (hasV2 && hasV3) both++
    })

    return {
      v2Wallets,
      v3Wallets,
      both,
    }
  })

  function setBalancesData(data: any) {
    rawBalancesData.value = data
  }

  function setPowerVotingData(data: any) {
    rawPowerVotingData.value = data
  }

  function setCurrentSnapshotDate(date: string | null) {
    currentSnapshotDate.value = date
  }

  /** Date du snapshot actuellement chargé (ex: "17-02-2026" ou "Actuel" pour upload). */
  const currentSnapshotDate = ref<string | null>(null)

  const comparisonSnapshot = ref<{
    balances: any
    powerVoting: any
    date: string
  } | null>(null)

  const snapshotComparison = computed(() => {
    if (!comparisonSnapshot.value) return null

    const current = {
      holders: walletBalances.value.length,
      poolWallets: addressPoolProfiles.value.length,
      totalPower: powerVoting.value.reduce((sum, p) => sum + parseFloat(String(p.powerVoting || 0)), 0),
    }

    const compBalances = comparisonSnapshot.value.balances.result?.balances || comparisonSnapshot.value.balances
    const compPower = comparisonSnapshot.value.powerVoting.result?.powerVoting || comparisonSnapshot.value.powerVoting

    const compBalancesArray = Array.isArray(compBalances) ? compBalances : []
    const compPowerArray = Array.isArray(compPower) ? compPower : []

    const compWalletBalances = compBalancesArray.filter((b: any) => String(b?.type || '') === 'wallet')

    // Calculate pool wallets for comparison (simplified - would need full processing)
    const compPoolWallets = compBalancesArray.filter((b: any) => {
      const networks = b.sourceBalance
      if (!networks) return false
      return Object.values(networks).some((net: any) => {
        const dexs = net?.dexs
        if (!dexs) return false
        return Object.values(dexs).some((positions: any) => Array.isArray(positions) && positions.length > 0)
      })
    }).length

    const comparison = {
      holders: compWalletBalances.length,
      poolWallets: compPoolWallets,
      totalPower: compPowerArray.reduce((sum: number, p: any) => sum + parseFloat(String(p.powerVoting || 0)), 0),
    }

    return {
      current,
      comparison,
      diff: {
        holders: current.holders - comparison.holders,
        poolWallets: current.poolWallets - comparison.poolWallets,
        totalPower: current.totalPower - comparison.totalPower,
      },
      date: comparisonSnapshot.value.date,
    }
  })

  function setComparisonSnapshot(data: { balances: any; powerVoting: any; date: string }) {
    comparisonSnapshot.value = data
  }

  function clearComparisonSnapshot() {
    comparisonSnapshot.value = null
  }

  function clearData() {
    rawBalancesData.value = null
    rawPowerVotingData.value = null
    comparisonSnapshot.value = null
    currentSnapshotDate.value = null
  }

  return {
    balances,
    powerVoting,
    balanceStats,
    powerVotingStats,
    balanceDistribution,
    powerVotingDistribution,
    topBalanceHolders,
    topPowerVoters,
    poolAnalysis,
    addressPoolProfiles,
    poolPowerCorrelation,
    poolWalletBreakdown,
    snapshotComparison,
    setBalancesData,
    setPowerVotingData,
    setCurrentSnapshotDate,
    currentSnapshotDate,
    setComparisonSnapshot,
    clearComparisonSnapshot,
    clearData,
  }
})

// Helper interfaces for Pool Analysis
interface PoolPosition {
  tokenBalance: string
  tokenSymbol: string
  equivalentREG: string
  poolAddress: string
  // V3 specific
  tickLower?: number
  tickUpper?: number
  currentTick?: number
  isActive?: boolean
}

interface PoolStats {
  totalREG: number
  count: number
  dexs: Record<string, number>
}

interface AddressPoolPosition extends PoolPosition {
  dex: string
  network: string
  poolType: 'v2' | 'v3'
  regAmount: number
  // Pour les positions V3 regroupées, stocker les détails de tous les tokens
  tokens?: Array<{
    tokenSymbol: string
    tokenBalance: string
    equivalentREG: string
  }>
}

interface AddressPoolProfile {
  address: string
  /** Total REG du snapshot (pour les graphiques) — ne pas utiliser pour l’affichage "REG en wallet" de la search bar */
  walletREG: number
  poolLiquidityREG: number
  positions: AddressPoolPosition[]
  poolCount: number
  dexCount: number
}

interface PoolPowerCorrelation extends AddressPoolProfile {
  powerVoting: number
  walletDirectREG: number
  walletVotingShare: number
  poolVotingShare: number
  boostMultiplier: number
}
