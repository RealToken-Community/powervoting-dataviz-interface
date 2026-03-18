import { computed, ref, watch, type Ref } from 'vue'
import { useDataStore } from '@/stores/dataStore'
import { loadSnapshot, type SnapshotInfo } from '@/utils/snapshotLoader'

export interface PreviousSnapshotPowerData {
  sortedByPower: Array<{ address: string; power: number }>
  totalPower: number
  date: string
}

export interface Top20HolderComparisonItem {
  rank: number
  address: string
  power: number
  pctTotal: number
  placeChange: number | null
  pctDiff: number | null
}

export interface PreviousTop20CurrentRankItem {
  previousRank: number
  address: string
  addressDisplay: string
  currentRank: number | null
  placeChange: number | null
  pctDiff: number
}

export interface FullSnapshotRankEvolutionSummary {
  upCount: number
  downCount: number
  sameCount: number
  avgGain: number
  avgLoss: number
}

export function useComparison(availableSnapshots: Ref<SnapshotInfo[]>) {
  const dataStore = useDataStore()

  const previousSnapshotPowerData = ref<PreviousSnapshotPowerData | null>(null)
  const isLoadingPreviousForTopHolders = ref(false)

  function getPreviousSnapshotForComparison(): SnapshotInfo | null {
    const currentDate = dataStore.currentSnapshotDate
    if (!currentDate || availableSnapshots.value.length === 0) return null
    if (currentDate === 'Actuel') return availableSnapshots.value[0] ?? null
    const idx = availableSnapshots.value.findIndex((s) => s.date === currentDate)
    if (idx === -1 || idx >= availableSnapshots.value.length - 1) return null
    return availableSnapshots.value[idx + 1] ?? null
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
      const addressDisplay =
        dataStore.powerVoting.find((p) => (p.address || '').toLowerCase() === item.address)?.address ?? item.address
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

  const fullSnapshotRankEvolutionSummary = computed((): FullSnapshotRankEvolutionSummary | null => {
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
    const prevRankByAddress = new Map<string, number>()
    prev.sortedByPower.forEach((item, i) => {
      prevRankByAddress.set(item.address, i + 1)
    })
    const placeChanges: number[] = []
    currentSorted.forEach((item) => {
      const prevRank = prevRankByAddress.get(item.address)
      if (prevRank == null) return
      const currentRank = currentRankByAddress.get(item.address) ?? 0
      placeChanges.push(prevRank - currentRank)
    })
    const up = placeChanges.filter((c) => c > 0)
    const down = placeChanges.filter((c) => c < 0)
    const same = placeChanges.filter((c) => c === 0)
    const avgGain = up.length > 0 ? up.reduce((s, c) => s + c, 0) / up.length : 0
    const avgLoss = down.length > 0 ? down.reduce((s, c) => s + Math.abs(c), 0) / down.length : 0
    return {
      upCount: up.length,
      downCount: down.length,
      sameCount: same.length,
      avgGain,
      avgLoss,
    }
  })

  return {
    previousSnapshotPowerData,
    isLoadingPreviousForTopHolders,
    getPreviousSnapshotForComparison,
    loadPreviousSnapshotForTopHolders,
    top20HoldersComparison,
    previousTop20CurrentRanks,
    fullSnapshotRankEvolutionSummary,
  }
}
