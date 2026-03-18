import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const snapshotDir = path.join(__dirname, '../public/snapshot')
const manifestPath = path.join(snapshotDir, 'manifest.json')

/** Read and parse a JSON file. */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

/** Sum REG from balances, filtered by allowed entry types. */
function computeBalancesMetrics(balancesArray, allowedTypes) {
  const filtered = balancesArray.filter((b) => allowedTypes.has(String(b.type || '')))
  const totalREG = filtered.reduce((sum, b) => {
    const source = b?.sourceBalance
    if (source && typeof source === 'object') {
      let onchain = 0
      Object.values(source).forEach((net) => {
        const v = parseFloat(String(net?.walletBalance ?? 0))
        if (!isNaN(v)) onchain += v
      })
      return sum + onchain
    }

    const reg = parseFloat(String(b.totalBalanceREG || b.totalBalance || 0))
    return sum + (isNaN(reg) ? 0 : reg)
  }, 0)

  return {
    walletCount: filtered.length,
    totalREG,
  }
}

function generateManifest() {
  const snapshots = []

  if (!fs.existsSync(snapshotDir)) {
    console.warn(`Snapshot directory not found: ${snapshotDir}`)
    return
  }

  const dateDirs = fs
    .readdirSync(snapshotDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)

  for (const dateDir of dateDirs) {
    const datePath = path.join(snapshotDir, dateDir)
    const files = fs.readdirSync(datePath)

    const balancesFile = files.find((f) => f.startsWith('balancesREG_') && f.endsWith('.json'))
    const powerFile = files.find((f) =>
      (f.startsWith('powerVotingREG_') || f.startsWith('powerVotingREG-')) && f.endsWith('.json'),
    )

    if (balancesFile && powerFile) {
      // Format date for sorting: DD-MM-YYYY -> YYYY-MM-DD
      const parts = dateDir.split('-')
      const dateFormatted = `${parts[2]}-${parts[1]}-${parts[0]}`

      // Calculate metrics from files
      let walletCount = 0
      let totalREG = 0
      let totalPowerVoting = 0

      try {
        // Read balances file
        const balancesPath = path.join(datePath, balancesFile)
        const balancesData = readJson(balancesPath)
        const balances = balancesData.result?.balances || balancesData
        const balancesArray = Array.isArray(balances) ? balances : []

        const balancesMetrics = computeBalancesMetrics(balancesArray, new Set(['wallet', 'liquidityPool']))
        walletCount = balancesMetrics.walletCount
        totalREG = balancesMetrics.totalREG

        // Read power voting file
        const powerPath = path.join(datePath, powerFile)
        const powerData = readJson(powerPath)
        const powerVoting = powerData.result?.powerVoting || powerData
        const powerArray = Array.isArray(powerVoting) ? powerVoting : []

        totalPowerVoting = powerArray.reduce((sum, p) => {
          const power = parseFloat(String(p.powerVoting || 0))
          return sum + (isNaN(power) ? 0 : power)
        }, 0)
      } catch (err) {
        console.warn(`⚠️  Could not calculate metrics for ${dateDir}:`, err.message)
        console.warn(`⚠️  balancesFile=${balancesFile} powerVotingFile=${powerFile}`)
      }

      snapshots.push({
        date: dateDir,
        dateFormatted,
        balancesFile,
        powerVotingFile: powerFile,
        metrics: {
          walletCount,
          totalREG: Math.round(totalREG * 100) / 100, // Round to 2 decimals
          totalPowerVoting: Math.round(totalPowerVoting * 100) / 100,
        },
      })
    }
  }

  // Sort by date descending (newest first)
  snapshots.sort((a, b) => {
    return new Date(b.dateFormatted).getTime() - new Date(a.dateFormatted).getTime()
  })

  const manifest = { snapshots }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`✅ Generated manifest with ${snapshots.length} snapshots`)
}

generateManifest()

