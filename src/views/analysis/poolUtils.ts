/**
 * Analyse les pools d’un snapshot entier (comptages V2/V3, concentration du pouvoir).
 */
export function analyzeSnapshotPools(balancesArray: any[], powerVotingArray: any[]) {
  let v2Pools = 0
  let v3Pools = 0
  let v3Active = 0
  let v3Inactive = 0
  const walletsWithPools = new Set<string>()
  let v3DataAvailable = false

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

          const tickLower = typeof pos.tickLower === 'number' ? pos.tickLower : parseFloat(String(pos.tickLower || 0))
          const tickUpper = typeof pos.tickUpper === 'number' ? pos.tickUpper : parseFloat(String(pos.tickUpper || 0))
          const isV2Transformed = tickLower === -887200 && tickUpper === 887200
          const hasTickLower = pos.tickLower !== undefined
          const hasTickUpper = pos.tickUpper !== undefined
          const isV3 = hasTickLower && hasTickUpper && !isV2Transformed

          if (hasTickLower || hasTickUpper) {
            v3DataAvailable = true
          }

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
          hasPools = true
        })
      })
    })

    if (hasPools) {
      walletsWithPools.add(wallet.walletAddress || '')
    }
  })

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
        const key = keys[index]
        if (key == null) return
        const topCount = Math.max(1, Math.floor(sortedPower.length * percent))
        const topPower = sortedPower.slice(0, topCount).reduce((sum, p) => sum + p, 0)
        powerConcentration[key] = (topPower / totalPower) * 100
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
    v3DataAvailable,
  }
}

/**
 * Compte le nombre de pools uniques et de positions V2 et V3 à partir des balances d'un snapshot.
 * Utilisé pour l'évolution dans l'historique des snapshots.
 * Si V3 n'est pas détecté (pas de positions avec tickLower/tickUpper), v3DataAvailable sera false.
 */
export function getUniquePoolCountsByType(balancesArray: any[]): {
  v2PoolCount: number
  v3PoolCount: number
  v2PositionCount: number
  v3PositionCount: number
  v3DataAvailable: boolean
} {
  const v2PoolIds = new Set<string>()
  const v3PoolIds = new Set<string>()
  let v2PositionCount = 0
  let v3PositionCount = 0
  let v3DataAvailable = false

  const raw = Array.isArray(balancesArray) ? balancesArray : (balancesArray as any)?.result?.balances
  const list = Array.isArray(raw) ? raw : []

  list.forEach((wallet: any) => {
    if (!wallet.sourceBalance) return
    const networks = wallet.sourceBalance

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
          const hasTickLower = pos.tickLower !== undefined
          const hasTickUpper = pos.tickUpper !== undefined
          const isV3 = hasTickLower && hasTickUpper && !isV2Transformed

          if (hasTickLower || hasTickUpper) {
            v3DataAvailable = true
          }

          const poolAddress = pos.poolAddress != null ? String(pos.poolAddress).toLowerCase() : null
          const fallbackKey = `${networkName}-${dexName}-${isV3 ? 'v3' : 'v2'}-${tickLower}-${tickUpper}`
          const poolKey = poolAddress ?? fallbackKey

          if (isV3) {
            v3PoolIds.add(poolKey)
            v3PositionCount++
          } else {
            v2PoolIds.add(poolKey)
            v2PositionCount++
          }
        })
      })
    })
  })

  return {
    v2PoolCount: v2PoolIds.size,
    v3PoolCount: v3PoolIds.size,
    v2PositionCount,
    v3PositionCount,
    v3DataAvailable,
  }
}

export interface AnalyzePoolPositionsResult {
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

/**
 * Analyse les positions de pools d’un wallet (V2/V3, in/out of range).
 */
export function analyzePoolPositions(walletData: any): AnalyzePoolPositionsResult | null {
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
