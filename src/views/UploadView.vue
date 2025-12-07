<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDataStore } from '@/stores/dataStore'
import { loadSnapshotManifest, loadSnapshot, type SnapshotInfo } from '@/utils/snapshotLoader'
import { transformCSVToJSON, transformPowerVotingCSV } from '@/utils/csvTransformer'
import Papa from 'papaparse'

const router = useRouter()
const dataStore = useDataStore()

const balancesFile = ref<File | null>(null)
const powerVotingFile = ref<File | null>(null)
const isLoading = ref(false)
const error = ref<string>('')
const snapshots = ref<SnapshotInfo[]>([])
const isLoadingSnapshots = ref(false)
const isDraggingBalances = ref(false)
const isDraggingPowerVoting = ref(false)

const handleFileChange = (event: Event, type: 'balances' | 'powerVoting') => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (file) {
    setFile(file, type)
  }
}

const setFile = (file: File, type: 'balances' | 'powerVoting') => {
  // Créer une nouvelle référence pour forcer la réactivité Vue
    if (type === 'balances') {
      balancesFile.value = file
    } else {
      powerVotingFile.value = file
    }
    error.value = ''
  // Forcer la mise à jour de l'affichage
  console.log(`File ${type} set:`, file.name)
}

const handleDragOver = (event: DragEvent, type: 'balances' | 'powerVoting') => {
  event.preventDefault()
  event.stopPropagation()
  if (type === 'balances') {
    isDraggingBalances.value = true
  } else {
    isDraggingPowerVoting.value = true
  }
}

const handleDragLeave = (event: DragEvent, type: 'balances' | 'powerVoting') => {
  event.preventDefault()
  event.stopPropagation()
  if (type === 'balances') {
    isDraggingBalances.value = false
  } else {
    isDraggingPowerVoting.value = false
  }
}

const handleDrop = (event: DragEvent, type: 'balances' | 'powerVoting') => {
  event.preventDefault()
  event.stopPropagation()
  
  if (type === 'balances') {
    isDraggingBalances.value = false
  } else {
    isDraggingPowerVoting.value = false
  }

  const files = event.dataTransfer?.files
  if (files && files.length > 0) {
    const file = files[0]
    // Vérifier l'extension du fichier
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (extension === 'csv' || extension === 'json') {
      setFile(file, type)
    } else {
      error.value = 'Format de fichier non supporté. Utilisez CSV ou JSON.'
    }
  }
}

const parseFile = async (file: File, type: 'balances' | 'powerVoting'): Promise<any> => {
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (extension === 'json') {
    const text = await file.text()
    return JSON.parse(text)
  } else if (extension === 'csv') {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        dynamicTyping: false, // Garder les valeurs comme strings pour la transformation
        skipEmptyLines: true,
        complete: (results) => {
          try {
            // Transformer les données CSV en structure JSON
            if (type === 'balances') {
              const transformed = transformCSVToJSON(results.data as any[])
              // Envelopper dans la structure result.balances pour correspondre au format JSON
              resolve({ result: { balances: transformed } })
            } else {
              const transformed = transformPowerVotingCSV(results.data as any[])
              // Envelopper dans la structure result.powerVoting pour correspondre au format JSON
              resolve({ result: { powerVoting: transformed } })
            }
          } catch (err) {
            reject(err)
          }
        },
        error: (err) => reject(err),
      })
    })
  } else {
    throw new Error('Format de fichier non supporté. Utilisez CSV ou JSON.')
  }
}

const handleUpload = async () => {
  if (!balancesFile.value || !powerVotingFile.value) {
    error.value = 'Veuillez sélectionner les deux fichiers'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    const [balancesData, powerVotingData] = await Promise.all([
      parseFile(balancesFile.value, 'balances'),
      parseFile(powerVotingFile.value, 'powerVoting'),
    ])

    dataStore.setBalancesData(balancesData)
    dataStore.setPowerVotingData(powerVotingData)

    router.push('/analysis')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors du chargement des fichiers'
  } finally {
    isLoading.value = false
  }
}

const loadMockData = async () => {
  isLoading.value = true
  error.value = ''

  try {
    const [balancesResponse, powerVotingResponse] = await Promise.all([
      fetch('/mock/balancesREG_2025-11-26T09h42mn49_utc+00.json'),
      fetch('/mock/powerVotingREG-balancesREGModel-linearModel_2025-11-26T09h43mn55_utc+00.json'),
    ])

    const balancesData = await balancesResponse.json()
    const powerVotingData = await powerVotingResponse.json()

    dataStore.setBalancesData(balancesData)
    dataStore.setPowerVotingData(powerVotingData)

    router.push('/analysis')
  } catch (err) {
    error.value = 'Erreur lors du chargement des données mock'
  } finally {
    isLoading.value = false
  }
}

onMounted(async () => {
  isLoadingSnapshots.value = true
  try {
    snapshots.value = await loadSnapshotManifest()
  } catch (err) {
    console.error('Failed to load snapshots:', err)
  } finally {
    isLoadingSnapshots.value = false
  }
})

const loadSnapshotData = async (snapshot: SnapshotInfo) => {
  isLoading.value = true
  error.value = ''

  try {
    const { balances, powerVoting } = await loadSnapshot(snapshot)

    dataStore.setBalancesData(balances)
    dataStore.setPowerVotingData(powerVoting)

    router.push('/analysis')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors du chargement du snapshot'
  } finally {
    isLoading.value = false
  }
}

const formatSnapshotDate = (dateStr: string) => {
  const [day, month, year] = dateStr.split('-')
  return new Date(`${year}-${month}-${day}`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
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

const getSnapshotDiff = (snapshot: SnapshotInfo) => {
  if (!snapshot.metrics || snapshots.value.length === 0) return null

  // Find the index of current snapshot
  const currentIndex = snapshots.value.findIndex((s) => s.date === snapshot.date)
  if (currentIndex === -1) return null

  // Get the previous snapshot (next in the list, which is chronologically earlier)
  const previousSnapshot = snapshots.value[currentIndex + 1]
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
</script>

<template>
  <div class="upload-view">
    <div class="upload-card">
      <div class="card-header">
        <h2>📊 Chargement des données</h2>
        <p>Importez vos fichiers balances REG et power voting pour commencer l'analyse</p>
      </div>

      <div class="upload-section">
        <div class="file-upload">
          <label
            class="file-label"
            :class="{ 'dragging': isDraggingBalances }"
            @dragover="(e) => handleDragOver(e, 'balances')"
            @dragleave="(e) => handleDragLeave(e, 'balances')"
            @drop="(e) => handleDrop(e, 'balances')"
          >
            <div class="file-icon">📂</div>
            <div class="file-info">
              <span class="file-title">Balances REG</span>
              <span class="file-subtitle">CSV ou JSON - Glissez-déposez ou cliquez</span>
            </div>
            <input
              type="file"
              accept=".csv,.json"
              @change="(e) => handleFileChange(e, 'balances')"
              class="file-input"
            />
          </label>
          <div v-if="balancesFile" class="file-selected">✓ {{ balancesFile.name }}</div>
        </div>

        <div class="file-upload">
          <label
            class="file-label"
            :class="{ 'dragging': isDraggingPowerVoting }"
            @dragover="(e) => handleDragOver(e, 'powerVoting')"
            @dragleave="(e) => handleDragLeave(e, 'powerVoting')"
            @drop="(e) => handleDrop(e, 'powerVoting')"
          >
            <div class="file-icon">⚡</div>
            <div class="file-info">
              <span class="file-title">Power Voting REG</span>
              <span class="file-subtitle">CSV ou JSON - Glissez-déposez ou cliquez</span>
            </div>
            <input
              type="file"
              accept=".csv,.json"
              @change="(e) => handleFileChange(e, 'powerVoting')"
              class="file-input"
            />
          </label>
          <div v-if="powerVotingFile" class="file-selected">✓ {{ powerVotingFile.name }}</div>
        </div>
      </div>

      <div v-if="error" class="error-message">⚠️ {{ error }}</div>

      <div class="button-group">
        <button
          @click="handleUpload"
          :disabled="!balancesFile || !powerVotingFile || isLoading"
          class="btn btn-primary"
        >
          <span v-if="!isLoading">🚀 Analyser les données</span>
          <span v-else class="loading">⏳ Chargement...</span>
        </button>

        <button @click="loadMockData" :disabled="isLoading" class="btn btn-secondary">
          <span v-if="!isLoading">🎯 Utiliser les données exemples</span>
          <span v-else class="loading">⏳ Chargement...</span>
        </button>
      </div>
    </div>

    <div class="snapshots-section" v-if="snapshots.length > 0">
      <div class="snapshots-header">
        <h3>📸 Snapshots historiques ({{ snapshots.length }})</h3>
        <p>Chargez un snapshot précédent pour analyse ou comparaison</p>
      </div>
      <div class="snapshots-list">
        <button
          v-for="snapshot in snapshots"
          :key="snapshot.date"
          @click="loadSnapshotData(snapshot)"
          :disabled="isLoading"
          class="snapshot-row"
        >
          <div class="snapshot-date-col">
            <div class="snapshot-date">{{ formatSnapshotDate(snapshot.date) }}</div>
          </div>
          <div class="snapshot-metrics-row" v-if="snapshot.metrics">
            <div class="snapshot-metric-item">
              <span class="metric-icon">👥</span>
              <div class="metric-content">
                <div class="metric-value-row">
                  <span class="metric-value">{{ formatInteger(snapshot.metrics.walletCount) }}</span>
                  <span
                    v-if="getSnapshotDiff(snapshot)"
                    class="metric-diff"
                    :class="getSnapshotDiff(snapshot)!.walletCount >= 0 ? 'positive' : 'negative'"
                  >
                    {{ formatDiff(getSnapshotDiff(snapshot)!.walletCount, true) }}
                  </span>
                </div>
                <span class="metric-label">wallets</span>
              </div>
            </div>
            <div class="snapshot-metric-item">
              <span class="metric-icon">💰</span>
              <div class="metric-content">
                <div class="metric-value-row">
                  <span class="metric-value">{{ formatNumber(snapshot.metrics.totalREG) }}</span>
                  <span
                    v-if="getSnapshotDiff(snapshot)"
                    class="metric-diff"
                    :class="getSnapshotDiff(snapshot)!.totalREG >= 0 ? 'positive' : 'negative'"
                  >
                    {{ formatDiff(getSnapshotDiff(snapshot)!.totalREG) }}
                  </span>
                </div>
                <span class="metric-label">REG</span>
              </div>
            </div>
            <div class="snapshot-metric-item">
              <span class="metric-icon">⚡</span>
              <div class="metric-content">
                <div class="metric-value-row">
                  <span class="metric-value">{{ formatNumber(snapshot.metrics.totalPowerVoting) }}</span>
                  <span
                    v-if="getSnapshotDiff(snapshot)"
                    class="metric-diff"
                    :class="getSnapshotDiff(snapshot)!.totalPowerVoting >= 0 ? 'positive' : 'negative'"
                  >
                    {{ formatDiff(getSnapshotDiff(snapshot)!.totalPowerVoting) }}
                  </span>
                </div>
                <span class="metric-label">Power</span>
              </div>
            </div>
          </div>
          <div class="snapshot-files" v-else>
            <span class="snapshot-file">📄 {{ snapshot.balancesFile }}</span>
            <span class="snapshot-file">⚡ {{ snapshot.powerVotingFile }}</span>
          </div>
        </button>
      </div>
    </div>

    <div class="info-cards">
      <div class="info-card">
        <div class="info-icon">📈</div>
        <h3>Analyses avancées</h3>
        <p>
          Visualisez les distributions de balances et de pouvoir de vote avec des graphiques
          interactifs
        </p>
      </div>
      <div class="info-card">
        <div class="info-icon">🔍</div>
        <h3>Statistiques détaillées</h3>
        <p>
          Obtenez des statistiques complètes sur vos données : moyenne, médiane, écart-type, etc.
        </p>
      </div>
      <div class="info-card">
        <div class="info-icon">💾</div>
        <h3>Multiple formats</h3>
        <p>Support des fichiers CSV et JSON pour une flexibilité maximale</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-view {
  animation: fadeIn 0.5s ease;
}

.upload-card {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 2.5rem;
  margin-bottom: 2rem;
  box-shadow: var(--shadow-xl);
}

.card-header {
  text-align: center;
  margin-bottom: 2.5rem;
}

.card-header h2 {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.card-header p {
  color: var(--text-secondary);
  font-size: 1rem;
}

.upload-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.file-upload {
  position: relative;
}

.file-label {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
  border: 2px dashed var(--border-color);
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.3s ease;
  background: var(--glass-bg);
}

.file-label:hover {
  border-color: var(--primary-color);
  background: var(--bg-tertiary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.file-label.dragging {
  border-color: var(--primary-color);
  background: rgba(99, 102, 241, 0.2);
  border-style: solid;
  transform: scale(1.02);
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.5);
}

.file-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.file-icon {
  font-size: 2.5rem;
}

.file-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.file-title {
  font-weight: 600;
  color: var(--text-primary);
}

.file-subtitle {
  font-size: 0.875rem;
  color: var(--text-muted);
}

.file-selected {
  margin-top: 0.75rem;
  padding: 0.5rem 1rem;
  background: var(--success-color);
  color: white;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  animation: slideIn 0.3s ease;
}

.error-message {
  padding: 1rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--error-color);
  border-radius: 0.5rem;
  color: var(--error-color);
  margin-bottom: 1.5rem;
  animation: fadeIn 0.3s ease;
}

.button-group {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.btn {
  flex: 1;
  min-width: 200px;
  padding: 1rem 2rem;
  border: none;
  border-radius: 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.btn::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  transform: translate(-50%, -50%);
  transition:
    width 0.6s,
    height 0.6s;
}

.btn:hover::before {
  width: 300px;
  height: 300px;
}

.btn-primary {
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
  color: white;
  box-shadow: var(--shadow-md);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-secondary);
  border-color: var(--primary-color);
  transform: translateY(-2px);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading {
  animation: pulse 1.5s ease-in-out infinite;
}

.info-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.info-card {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-color);
  border-radius: 1rem;
  padding: 2rem;
  text-align: center;
  transition: all 0.3s ease;
  animation: fadeIn 0.5s ease;
}

.info-card:nth-child(2) {
  animation-delay: 0.1s;
}

.info-card:nth-child(3) {
  animation-delay: 0.2s;
}

.info-card:hover {
  transform: translateY(-4px);
  border-color: var(--primary-color);
  box-shadow: var(--shadow-lg);
}

.info-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.info-card h3 {
  font-size: 1.25rem;
  margin-bottom: 0.75rem;
  color: var(--text-primary);
}

.info-card p {
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.6;
}

.snapshots-section {
  margin: 3rem 0;
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 2rem;
  box-shadow: var(--shadow-lg);
}

.snapshots-header {
  text-align: center;
  margin-bottom: 2rem;
}

.snapshots-header h3 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

.snapshots-header p {
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.snapshots-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.snapshot-row {
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

.snapshot-row:hover:not(:disabled) {
  border-color: var(--primary-color);
  background: var(--bg-tertiary);
  transform: translateX(4px);
  box-shadow: var(--shadow-md);
}

.snapshot-row:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.snapshot-date-col {
  display: flex;
  align-items: center;
}

.snapshot-date {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 1rem;
}

.snapshot-metrics-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
  align-items: center;
}

.snapshot-metric-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.metric-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.metric-content {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
}

.metric-value-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.metric-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.metric-diff {
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 0.25rem;
  line-height: 1.2;
}

.metric-diff.positive {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
}

.metric-diff.negative {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.metric-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.snapshot-files {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.snapshot-file {
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-family: 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .upload-card {
    padding: 1.5rem;
  }

  .card-header h2 {
    font-size: 1.5rem;
  }

  .upload-section {
    grid-template-columns: 1fr;
  }

  .button-group {
    flex-direction: column;
  }

  .btn {
    min-width: 100%;
  }

  .snapshot-row {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .snapshot-metrics-row {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
</style>
