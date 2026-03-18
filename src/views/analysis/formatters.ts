import type { SnapshotInfo } from '@/utils/snapshotLoader'

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}

export function formatInteger(num: number): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(num))
}

export function getSnapshotDiff(snapshot: SnapshotInfo, allSnapshots: SnapshotInfo[]) {
  if (!snapshot.metrics || allSnapshots.length === 0) return null

  const currentIndex = allSnapshots.findIndex((s) => s.date === snapshot.date)
  if (currentIndex === -1) return null

  const previousSnapshot = allSnapshots[currentIndex + 1]
  if (!previousSnapshot || !previousSnapshot.metrics) return null

  return {
    walletCount: snapshot.metrics.walletCount - previousSnapshot.metrics.walletCount,
    totalREG: snapshot.metrics.totalREG - previousSnapshot.metrics.totalREG,
    totalPowerVoting: snapshot.metrics.totalPowerVoting - previousSnapshot.metrics.totalPowerVoting,
  }
}

export function formatDiff(diff: number, isInteger = false): string {
  if (diff === 0) return ''
  const formatted = isInteger ? formatInteger(Math.abs(diff)) : formatNumber(Math.abs(diff))
  return diff > 0 ? `+${formatted}` : `-${formatted}`
}

export function shortAddress(addr: string): string {
  if (!addr || addr.length < 14) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
