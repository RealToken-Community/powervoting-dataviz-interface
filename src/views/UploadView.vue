<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '@/stores/dataStore'
import { transformCSVToJSON, transformPowerVotingCSV } from '@/utils/csvTransformer'
import { sessionHeaders } from '@/composables/useSessionId'
import Papa from 'papaparse'

const router = useRouter()
const { t } = useI18n()
const dataStore = useDataStore()

const balancesFile = ref<File | null>(null)
const powerVotingFile = ref<File | null>(null)
const isLoading = ref(false)
const error = ref<string>('')
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
    dataStore.setCurrentSnapshotDate('Actuel')

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
    dataStore.setCurrentSnapshotDate('Actuel')

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
    const response = await fetch('/api/files', { credentials: 'include', headers: sessionHeaders() })
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

onMounted(() => {
  loadGeneratedFiles()
})

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
</script>

<template>
  <div class="upload-view">
    <div class="upload-card">
      <div class="card-header">
        <h2>📊 {{ t('upload.title') }}</h2>
        <p>{{ t('upload.subtitle') }}</p>
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
              <span class="file-title">{{ t('upload.balances') }}</span>
              <span class="file-subtitle">{{ t('upload.dragDrop') }}</span>
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
              <span class="file-title">{{ t('upload.powerVoting') }}</span>
              <span class="file-subtitle">{{ t('upload.dragDrop') }}</span>
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
          <span v-if="!isLoading">🚀 {{ t('upload.load') }}</span>
          <span v-else class="loading">⏳ {{ t('upload.loading') }}</span>
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
        <h4 class="category-title">💰 {{ t('upload.balancesCount', { count: categorizedFiles.balances.length }) }}</h4>
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
        <h4 class="category-title">⚡ {{ t('upload.powerVotingCount', { count: categorizedFiles.powerVoting.length }) }}</h4>
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
}
</style>




