<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDataStore } from '@/stores/dataStore'
import { loadSnapshotManifest, loadSnapshot, type SnapshotInfo } from '@/utils/snapshotLoader'
import { transformCSVToJSON, transformPowerVotingCSV } from '@/utils/csvTransformer'
import { sessionHeaders } from '@/composables/useSessionId'
import Papa from 'papaparse'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
} from 'chart.js'

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
)

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
const generatedFiles = ref<Array<{
  name: string
  size: number
  created: Date
  modified: Date
  type: string
  url: string
}>>([])
const isLoadingGeneratedFiles = ref(false)

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
    
    // Vérifier que le fichier n'est pas vide
    if (!text || text.trim().length === 0) {
      throw new Error('Le fichier JSON est vide')
    }
    
    try {
      const parsed = JSON.parse(text)
      
      // Vérifier que le JSON parsé n'est pas vide
      if (!parsed || (typeof parsed === 'object' && Object.keys(parsed).length === 0)) {
        throw new Error('Le fichier JSON ne contient aucune donnée')
      }
      
      return parsed
    } catch (parseError) {
      if (parseError instanceof SyntaxError) {
        throw new Error(`Erreur de syntaxe JSON: ${parseError.message}. Vérifiez que le fichier est un JSON valide.`)
      }
      throw parseError
    }
  } else if (extension === 'csv') {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        dynamicTyping: false, // Garder les valeurs comme strings pour la transformation
        skipEmptyLines: true,
        complete: (results) => {
          try {
            // Vérifier que le CSV contient des données
            if (!results.data || results.data.length === 0) {
              reject(new Error('Le fichier CSV est vide ou ne contient aucune donnée'))
              return
            }
            
            // Transformer les données CSV en structure JSON
            if (type === 'balances') {
              const transformed = transformCSVToJSON(results.data as any[])
              // Vérifier que la transformation a produit des données
              if (!transformed || transformed.length === 0) {
                reject(new Error('Aucune donnée de balances trouvée dans le fichier CSV'))
                return
              }
              // Envelopper dans la structure result.balances pour correspondre au format JSON
              resolve({ result: { balances: transformed } })
            } else {
              const transformed = transformPowerVotingCSV(results.data as any[])
              // Vérifier que la transformation a produit des données
              if (!transformed || transformed.length === 0) {
                reject(new Error('Aucune donnée de power voting trouvée dans le fichier CSV'))
                return
              }
              // Envelopper dans la structure result.powerVoting pour correspondre au format JSON
              resolve({ result: { powerVoting: transformed } })
            }
          } catch (err) {
            reject(err instanceof Error ? err : new Error('Erreur lors de la transformation des données CSV'))
          }
        },
        error: (err) => {
          reject(new Error(`Erreur lors du parsing CSV: ${err.message || 'Format CSV invalide'}`))
        },
      })
    })
  } else {
    throw new Error('Format de fichier non supporté. Utilisez CSV ou JSON.')
  }
}

const handleUpload = async () => {
  isLoading.value = true
  error.value = ''

  try {
    // Vérifier si les données sont déjà dans le store (via useGeneratedFile)
    const hasBalancesData = dataStore.balances && dataStore.balances.length > 0
    const hasPowerVotingData = dataStore.powerVoting && dataStore.powerVoting.length > 0

    // Ne rediriger sans parser que si le store a des données ET que l'utilisateur
    // n'a pas sélectionné de vrais fichiers (ex. après useGeneratedFile → fichiers "dummy" size 0).
    // Dès qu'au moins un fichier réel est sélectionné (size > 0), on parse pour mettre à jour le store,
    // ce qui évite d'afficher d'anciennes données (mauvais total, pools V3 manquants).
    const hasBothFiles = !!balancesFile.value && !!powerVotingFile.value
    const hasRealFiles = hasBothFiles && (
      (balancesFile.value?.size ?? 0) > 0 || (powerVotingFile.value?.size ?? 0) > 0
    )
    if (hasBalancesData && hasPowerVotingData && hasBothFiles && !hasRealFiles) {
      console.log('Données déjà chargées (fichiers générés), redirection vers Analysis')
      await router.push('/analysis')
      return
    }

    if (!balancesFile.value || !powerVotingFile.value) {
      error.value = 'Veuillez sélectionner les deux fichiers'
      isLoading.value = false
      return
    }

    console.log('Parsing des fichiers...', {
      balancesFile: balancesFile.value.name,
      powerVotingFile: powerVotingFile.value.name
    })

    const [balancesData, powerVotingData] = await Promise.all([
      parseFile(balancesFile.value, 'balances'),
      parseFile(powerVotingFile.value, 'powerVoting'),
    ])

    console.log('Fichiers parsés avec succès:', {
      balancesDataKeys: Object.keys(balancesData || {}),
      powerVotingDataKeys: Object.keys(powerVotingData || {})
    })

    dataStore.setBalancesData(balancesData)
    dataStore.setPowerVotingData(powerVotingData)

    // Vérifier que les données sont bien stockées
    const balancesCount = dataStore.balances.length
    const powerVotingCount = dataStore.powerVoting.length
    console.log('Données stockées dans le store:', {
      balancesCount,
      powerVotingCount
    })

    if (balancesCount === 0 || powerVotingCount === 0) {
      throw new Error(`Données invalides: ${balancesCount} balances, ${powerVotingCount} power voting`)
    }

    // S'assurer que la navigation se fait après que les données soient stockées
    console.log('Redirection vers Analysis...')
    await router.push('/analysis')
  } catch (err) {
    console.error('Erreur lors du chargement des fichiers:', err)
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

const loadGeneratedFiles = async () => {
  isLoadingGeneratedFiles.value = true
  try {
    const response = await fetch('/api/files', { headers: sessionHeaders() })
    if (response.ok) {
      generatedFiles.value = await response.json()
    }
  } catch (err) {
    console.error('Failed to load generated files:', err)
  } finally {
    isLoadingGeneratedFiles.value = false
  }
}

// Fonction pour télécharger un fichier
const downloadFile = async (file: { name: string; url: string }) => {
  try {
    const response = await fetch(file.url)
    if (!response.ok) throw new Error('Erreur lors du téléchargement')
    
    const blob = await response.blob()
    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(downloadUrl)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors du téléchargement'
  }
}

const useGeneratedFile = async (file: { name: string; url: string }, type: 'balances' | 'powerVoting') => {
  isLoading.value = true
  error.value = ''

  try {
    const response = await fetch(file.url)
    if (!response.ok) throw new Error('Erreur lors du chargement du fichier')

    const extension = file.name.split('.').pop()?.toLowerCase()
    let data: any

    if (extension === 'json') {
      data = await response.json()
    } else if (extension === 'csv') {
      const text = await response.text()
      data = await new Promise((resolve, reject) => {
        Papa.parse(text, {
          header: true,
          dynamicTyping: false,
          skipEmptyLines: true,
          complete: (results) => {
            try {
              if (type === 'balances') {
                const transformed = transformCSVToJSON(results.data as any[])
                resolve({ result: { balances: transformed } })
              } else {
                const transformed = transformPowerVotingCSV(results.data as any[])
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
      throw new Error('Format de fichier non supporté')
    }

    if (type === 'balances') {
      dataStore.setBalancesData(data)
      balancesFile.value = new File([], file.name) as File
    } else {
      dataStore.setPowerVotingData(data)
      powerVotingFile.value = new File([], file.name) as File
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur inconnue'
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
  loadGeneratedFiles()
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

// Grouper les fichiers par nom de base (sans extension) pour regrouper CSV et JSON
const groupFilesByName = (files: typeof generatedFiles.value) => {
  const groups = new Map<string, typeof generatedFiles.value>()
  
  files.forEach(file => {
    // Extraire le nom de base sans extension
    const baseName = file.name.replace(/\.(csv|json)$/i, '')
    
    if (!groups.has(baseName)) {
      groups.set(baseName, [])
    }
    groups.get(baseName)!.push(file)
  })
  
  // Convertir en tableau et trier par date de modification décroissante
  return Array.from(groups.values()).sort((a, b) => {
    // Utiliser la date la plus récente du groupe
    const dateA = Math.max(...a.map(f => new Date(f.modified).getTime()))
    const dateB = Math.max(...b.map(f => new Date(f.modified).getTime()))
    return dateB - dateA
  })
}

// Catégoriser et trier les fichiers générés
const categorizedFiles = computed(() => {
  const balances: typeof generatedFiles.value = []
  const powerVoting: typeof generatedFiles.value = []
  const mock: typeof generatedFiles.value = []
  const debug: typeof generatedFiles.value = []

  generatedFiles.value.forEach(file => {
    const name = file.name.toLowerCase()
    
    // Priorité 1: Power Voting (si le nom contient "powervoting")
    if (name.includes('powervoting')) {
      powerVoting.push(file)
    }
    // Priorité 2: Debug (si le nom contient "debug")
    else if (name.includes('debug')) {
      debug.push(file)
    }
    // Priorité 3: Mock (si le nom contient "mock")
    else if (name.includes('mock')) {
      mock.push(file)
    }
    // Sinon: Balances (par défaut, comme balancesREG_...)
    else {
      balances.push(file)
    }
  })

  return {
    balances: groupFilesByName(balances),
    powerVoting: groupFilesByName(powerVoting),
    mock: groupFilesByName(mock),
    debug: groupFilesByName(debug)
  }
})

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

// Chart data for snapshots history
const snapshotsChartData = computed(() => {
  if (snapshots.value.length === 0) return null

  // Filter snapshots with metrics and sort by date (oldest first for chart)
  const snapshotsWithMetrics = snapshots.value
    .filter(s => s.metrics)
    .sort((a, b) => {
      const dateA = new Date(a.dateFormatted || a.date.split('-').reverse().join('-'))
      const dateB = new Date(b.dateFormatted || b.date.split('-').reverse().join('-'))
      return dateA.getTime() - dateB.getTime()
    })

  if (snapshotsWithMetrics.length === 0) return null

  const labels = snapshotsWithMetrics.map(s => formatSnapshotDate(s.date))
  const totalREG = snapshotsWithMetrics.map(s => s.metrics!.totalREG)
  const totalPowerVoting = snapshotsWithMetrics.map(s => s.metrics!.totalPowerVoting)

  return {
    labels,
    datasets: [
      {
        label: 'Total REG',
        data: totalREG,
        borderColor: 'rgb(34, 197, 94)',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        tension: 0.4,
        yAxisID: 'y1',
        borderWidth: 2,
      },
      {
        label: 'Total Power Voting',
        data: totalPowerVoting,
        borderColor: 'rgb(236, 72, 153)',
        backgroundColor: 'rgba(236, 72, 153, 0.1)',
        tension: 0.4,
        yAxisID: 'y2',
        borderWidth: 2,
      },
    ],
  }
})

const snapshotsChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
        color: 'rgb(255, 255, 255)',
        usePointStyle: true,
        padding: 15,
      },
    },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      titleColor: 'rgb(255, 255, 255)',
      bodyColor: 'rgb(255, 255, 255)',
      callbacks: {
        label: function(context: any) {
          let label = context.dataset.label || ''
          if (label) {
            label += ': '
          }
          label += formatNumber(context.parsed.y)
          return label
        },
      },
    },
  },
  scales: {
    x: {
      ticks: {
        color: 'rgb(255, 255, 255)',
        maxRotation: 45,
        minRotation: 45,
      },
      grid: {
        color: 'rgba(255, 255, 255, 0.2)',
      },
    },
    y1: {
      type: 'linear' as const,
      display: true,
      position: 'left' as const,
      ticks: {
        color: 'rgb(255, 255, 255)',
        callback: function(value: any) {
          return formatNumber(value)
        },
      },
      grid: {
        color: 'rgba(255, 255, 255, 0.2)',
      },
      title: {
        display: true,
        text: 'Total REG',
        color: 'rgb(34, 197, 94)',
      },
    },
    y2: {
      type: 'linear' as const,
      display: true,
      position: 'right' as const,
      ticks: {
        color: 'rgb(255, 255, 255)',
        callback: function(value: any) {
          return formatNumber(value)
        },
      },
      grid: {
        drawOnChartArea: false,
      },
      title: {
        display: true,
        text: 'Total Power Voting',
        color: 'rgb(236, 72, 153)',
      },
    },
  },
  interaction: {
    mode: 'nearest' as const,
    axis: 'x' as const,
    intersect: false,
  },
}))
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
          style="width: 100%;"
        >
          <span v-if="!isLoading">🚀 Analyser les données</span>
          <span v-else class="loading">⏳ Chargement...</span>
        </button>
      </div>
    </div>

    <div class="generated-files-section" v-if="generatedFiles.length > 0">
      <div class="section-header">
        <h3>⚙️ Fichiers générés ({{ generatedFiles.length }})</h3>
        <p>Fichiers créés depuis la page Generate</p>
        <button @click="loadGeneratedFiles" class="btn-refresh" :disabled="isLoadingGeneratedFiles">
          {{ isLoadingGeneratedFiles ? '⏳' : '🔄' }} Actualiser
        </button>
      </div>

      <!-- Section Balances -->
      <div v-if="categorizedFiles.balances.length > 0" class="file-category">
        <h4 class="category-title">💰 Balances ({{ categorizedFiles.balances.length }})</h4>
        <div class="generated-files-grid">
          <div
            v-for="fileGroup in categorizedFiles.balances"
            :key="fileGroup[0].name"
            class="generated-file-card"
          >
            <div class="file-name">{{ fileGroup[0].name.replace(/\.(csv|json)$/i, '') }}</div>
            <div class="file-formats">
              <span
                v-for="file in fileGroup"
                :key="file.name"
                class="file-format-badge"
                :class="{ 'format-csv': file.name.endsWith('.csv'), 'format-json': file.name.endsWith('.json') }"
                @click.stop="downloadFile(file)"
                :title="`Télécharger ${file.name}`"
                style="cursor: pointer; transition: all 0.2s ease;"
              >
                {{ file.name.split('.').pop()?.toUpperCase() }}
              </span>
            </div>
            <div class="file-meta">
              <span>{{ new Date(Math.max(...fileGroup.map(f => new Date(f.modified).getTime()))).toLocaleString('fr-FR') }}</span>
            </div>
            <div class="file-actions">
              <button
                v-for="file in fileGroup"
                :key="file.name"
                @click="useGeneratedFile(file, 'balances')"
                :disabled="isLoading"
                class="btn btn-small btn-primary"
              >
                📤 Utiliser {{ file.name.endsWith('.csv') ? 'CSV' : 'JSON' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Section Power Voting -->
      <div v-if="categorizedFiles.powerVoting.length > 0" class="file-category">
        <h4 class="category-title">⚡ Power Voting ({{ categorizedFiles.powerVoting.length }})</h4>
        <div class="generated-files-grid">
          <div
            v-for="fileGroup in categorizedFiles.powerVoting"
            :key="fileGroup[0].name"
            class="generated-file-card"
          >
            <div class="file-name">{{ fileGroup[0].name.replace(/\.(csv|json)$/i, '') }}</div>
            <div class="file-formats">
              <span
                v-for="file in fileGroup"
                :key="file.name"
                class="file-format-badge"
                :class="{ 'format-csv': file.name.endsWith('.csv'), 'format-json': file.name.endsWith('.json') }"
                @click.stop="downloadFile(file)"
                :title="`Télécharger ${file.name}`"
                style="cursor: pointer; transition: all 0.2s ease;"
              >
                {{ file.name.split('.').pop()?.toUpperCase() }}
              </span>
            </div>
            <div class="file-meta">
              <span>{{ new Date(Math.max(...fileGroup.map(f => new Date(f.modified).getTime()))).toLocaleString('fr-FR') }}</span>
            </div>
            <div class="file-actions">
              <button
                v-for="file in fileGroup"
                :key="file.name"
                @click="useGeneratedFile(file, 'powerVoting')"
                :disabled="isLoading"
                class="btn btn-small btn-primary"
              >
                📤 Utiliser {{ file.name.endsWith('.csv') ? 'CSV' : 'JSON' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Section Mock -->
      <div v-if="categorizedFiles.mock.length > 0" class="file-category">
        <h4 class="category-title">🎯 Mock ({{ categorizedFiles.mock.length }})</h4>
        <div class="generated-files-grid">
          <div
            v-for="fileGroup in categorizedFiles.mock"
            :key="fileGroup[0].name"
            class="generated-file-card"
          >
            <div class="file-name">{{ fileGroup[0].name.replace(/\.(csv|json)$/i, '') }}</div>
            <div class="file-formats">
              <span
                v-for="file in fileGroup"
                :key="file.name"
                class="file-format-badge"
                :class="{ 'format-csv': file.name.endsWith('.csv'), 'format-json': file.name.endsWith('.json') }"
                @click.stop="downloadFile(file)"
                :title="`Télécharger ${file.name}`"
                style="cursor: pointer; transition: all 0.2s ease;"
              >
                {{ file.name.split('.').pop()?.toUpperCase() }}
              </span>
            </div>
            <div class="file-meta">
              <span>{{ new Date(Math.max(...fileGroup.map(f => new Date(f.modified).getTime()))).toLocaleString('fr-FR') }}</span>
            </div>
            <div class="file-actions">
              <template v-for="file in fileGroup" :key="file.name">
                <button
                  v-if="file.name.toLowerCase().includes('balancesreg') || file.name.toLowerCase().includes('balances')"
                  @click="useGeneratedFile(file, 'balances')"
                  :disabled="isLoading"
                  class="btn btn-small btn-primary"
                >
                  📤 Utiliser {{ file.name.endsWith('.csv') ? 'CSV' : 'JSON' }} (Balances)
                </button>
                <button
                  v-if="file.name.toLowerCase().includes('powervoting') || file.name.toLowerCase().includes('power')"
                  @click="useGeneratedFile(file, 'powerVoting')"
                  :disabled="isLoading"
                  class="btn btn-small btn-primary"
                >
                  📤 Utiliser {{ file.name.endsWith('.csv') ? 'CSV' : 'JSON' }} (Power Voting)
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Section Debug -->
      <div v-if="categorizedFiles.debug.length > 0" class="file-category">
        <h4 class="category-title">🐛 Debug ({{ categorizedFiles.debug.length }})</h4>
        <div class="generated-files-grid">
          <div
            v-for="fileGroup in categorizedFiles.debug"
            :key="fileGroup[0].name"
            class="generated-file-card"
          >
            <div class="file-name">{{ fileGroup[0].name.replace(/\.(csv|json)$/i, '') }}</div>
            <div class="file-formats">
              <span
                v-for="file in fileGroup"
                :key="file.name"
                class="file-format-badge"
                :class="{ 'format-csv': file.name.endsWith('.csv'), 'format-json': file.name.endsWith('.json') }"
                @click.stop="downloadFile(file)"
                :title="`Télécharger ${file.name}`"
                style="cursor: pointer; transition: all 0.2s ease;"
              >
                {{ file.name.split('.').pop()?.toUpperCase() }}
              </span>
            </div>
            <div class="file-meta">
              <span>{{ new Date(Math.max(...fileGroup.map(f => new Date(f.modified).getTime()))).toLocaleString('fr-FR') }}</span>
            </div>
            <div class="file-actions">
              <template v-for="file in fileGroup" :key="file.name">
                <button
                  v-if="file.name.toLowerCase().includes('balancesreg') || file.name.toLowerCase().includes('balances')"
                  @click="useGeneratedFile(file, 'balances')"
                  :disabled="isLoading"
                  class="btn btn-small btn-primary"
                >
                  📤 Utiliser {{ file.name.endsWith('.csv') ? 'CSV' : 'JSON' }} (Balances)
                </button>
                <button
                  v-if="file.name.toLowerCase().includes('powervoting') || file.name.toLowerCase().includes('power')"
                  @click="useGeneratedFile(file, 'powerVoting')"
                  :disabled="isLoading"
                  class="btn btn-small btn-primary"
                >
                  📤 Utiliser {{ file.name.endsWith('.csv') ? 'CSV' : 'JSON' }} (Power Voting)
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="snapshots-section" v-if="snapshots.length > 0">
      <div class="snapshots-header">
        <h3>📸 Snapshots historiques ({{ snapshots.length }})</h3>
        <p class="snapshots-header-desc">
          Cliquez sur un snapshot pour le charger et ouvrir directement la page <strong>Analyse</strong> avec les données de ce snapshot.
        </p>
      </div>

      <div class="snapshots-list">
        <button
          v-for="snapshot in snapshots"
          :key="snapshot.date"
          @click="loadSnapshotData(snapshot)"
          :disabled="isLoading"
          class="snapshot-row"
          type="button"
          :title="'Charger le snapshot du ' + formatSnapshotDate(snapshot.date) + ' et ouvrir l\'analyse'"
        >
          <div class="snapshot-date-col">
            <div class="snapshot-date">{{ formatSnapshotDate(snapshot.date) }}</div>
            <span class="snapshot-click-hint">Cliquer pour voir l’analyse →</span>
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
      
      <!-- Chart historique -->
      <div class="snapshots-chart-container" v-if="snapshotsChartData">
        <Line :data="snapshotsChartData" :options="snapshotsChartOptions" />
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
  background: var(--primary-color);
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
  background: var(--primary-color);
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

.generated-files-section {
  margin: 3rem 0;
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 2rem;
  box-shadow: var(--shadow-lg);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.section-header h3 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

.section-header p {
  color: var(--text-secondary);
  font-size: 0.95rem;
  flex-basis: 100%;
}

.btn-refresh {
  padding: 0.5rem 1rem;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.3s ease;
  font-size: 0.875rem;
}

.btn-refresh:hover:not(:disabled) {
  background: var(--bg-secondary);
  border-color: var(--primary-color);
}

.btn-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.file-category {
  margin-bottom: 2.5rem;
}

.file-category:last-child {
  margin-bottom: 0;
}

.category-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid var(--border-color);
}

.generated-files-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.generated-file-card {
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  padding: 1.25rem;
  transition: all 0.3s ease;
}

.generated-file-card:hover {
  border-color: var(--primary-color);
  background: var(--bg-tertiary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.generated-file-card .file-name {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
  font-family: 'Courier New', monospace;
  font-size: 0.9rem;
  word-break: break-all;
}

.file-formats {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}

.file-format-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.format-csv {
  background: rgba(99, 102, 241, 0.2);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.format-csv:hover {
  background: rgba(99, 102, 241, 0.3);
  border-color: rgba(99, 102, 241, 0.5);
  transform: scale(1.05);
}

.format-json {
  background: rgba(139, 92, 246, 0.2);
  color: #a78bfa;
  border: 1px solid rgba(139, 92, 246, 0.3);
}

.format-json:hover {
  background: rgba(139, 92, 246, 0.3);
  border-color: rgba(139, 92, 246, 0.5);
  transform: scale(1.05);
}

.generated-file-card .file-meta {
  font-size: 0.875rem;
  color: var(--text-muted);
  margin-bottom: 1rem;
}

.generated-file-card .file-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.generated-file-card .file-actions .btn {
  width: 100%;
}

.btn-small {
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
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

.snapshots-header-desc {
  max-width: 520px;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.5;
}

.snapshots-header-desc strong {
  color: var(--primary-color);
}

.snapshots-chart-container {
  margin: 2rem 0;
  padding: 1.5rem;
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  height: 400px;
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
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}

.snapshot-date {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 1rem;
}

.snapshot-click-hint {
  font-size: 0.8rem;
  color: var(--primary-color);
  opacity: 0.9;
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




