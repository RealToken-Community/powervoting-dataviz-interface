<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDataStore } from '@/stores/dataStore'
import { transformCSVToJSON, transformPowerVotingCSV } from '@/utils/csvTransformer'
import Papa from 'papaparse'

const router = useRouter()
const dataStore = useDataStore()

const files = ref<Array<{
  name: string
  size: number
  created: Date
  modified: Date
  type: string
  url: string
}>>([])
const isLoading = ref(false)
const isRebuilding = ref(false)
const error = ref<string>('')
const success = ref<string>('')
const showBalancesModal = ref(false)
const showPowerVotingModal = ref(false)
const balancesLogs = ref<Array<{ type: string; message: string; timestamp: string }>>([])
const currentProcessId = ref<string | null>(null)
const eventSource = ref<EventSource | null>(null)
const pendingPrompt = ref<{
  type: 'select' | 'input' | 'confirm'
  question: string
  options?: string[]
  default?: string | boolean
} | null>(null)
const promptAnswer = ref<string>('')

// Paramètres pour la génération des balances
const balancesParams = ref({
  networks: ['gnosis'] as string[],
  dexs: {
    gnosis: ['honeyswap', 'sushiswap', 'balancer', 'swaprhq'] as string[],
    ethereum: [] as string[],
    polygon: [] as string[],
  },
  startDate: '',
  endDate: '',
  snapshotTime: '00:00',
  targetAddress: 'all',
  useMock: false,
})

// Options disponibles
const availableNetworks = ['gnosis', 'ethereum', 'polygon']
const availableDexs = {
  gnosis: ['honeyswap', 'sushiswap', 'balancer', 'swaprhq'],
  ethereum: [],
  polygon: [],
}

const API_BASE = '/api'

const loadFiles = async () => {
  try {
    const response = await fetch(`${API_BASE}/files`)
    if (!response.ok) throw new Error('Erreur lors du chargement des fichiers')
    files.value = await response.json()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur inconnue'
  }
}

const openBalancesModal = () => {
  // Initialiser avec la date d'aujourd'hui
  const today = new Date().toISOString().split('T')[0]
  balancesParams.value.startDate = today
  balancesParams.value.endDate = today
  showBalancesModal.value = true
}

const closeBalancesModal = () => {
  stopLogsStream()
  showBalancesModal.value = false
  isLoading.value = false
  pendingPrompt.value = null
  promptAnswer.value = ''
}

const startLogsStream = (processId: string) => {
  // Fermer l'ancien stream s'il existe
  if (eventSource.value) {
    eventSource.value.close()
  }
  
  balancesLogs.value = []
  currentProcessId.value = processId
  
  // Créer un nouveau EventSource pour les logs
  eventSource.value = new EventSource(`${API_BASE}/generate/balances/logs/${processId}`)
  
  eventSource.value.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data)
      balancesLogs.value.push(log)
      
      // Détecter les prompts inquirer dans les logs
      detectPrompt(log.message)
      
      // Faire défiler automatiquement vers le bas
      setTimeout(() => {
        const logsContainer = document.getElementById('balances-logs-container')
        if (logsContainer) {
          logsContainer.scrollTop = logsContainer.scrollHeight
        }
      }, 100)
    } catch (err) {
      console.error('Error parsing log:', err)
    }
  }
  
  eventSource.value.onerror = (err) => {
    console.error('EventSource error:', err)
    // Ne pas fermer automatiquement, laisser l'utilisateur le faire
  }
}

const stopLogsStream = () => {
  if (eventSource.value) {
    eventSource.value.close()
    eventSource.value = null
  }
  currentProcessId.value = null
}

const generateBalances = async () => {
  // Valider les paramètres
  if (!balancesParams.value.startDate || !balancesParams.value.endDate) {
    error.value = 'Veuillez sélectionner une plage de dates'
    return
  }

  if (balancesParams.value.networks.length === 0) {
    error.value = 'Veuillez sélectionner au moins un réseau'
    return
  }

  isLoading.value = true
  error.value = ''
  success.value = ''
  balancesLogs.value = []

  try {
    const response = await fetch(`${API_BASE}/generate/balances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(balancesParams.value),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Erreur lors de la génération' }))
      throw new Error(errorData.error || 'Erreur lors de la génération')
    }

    const data = await response.json()
    success.value = data.message || 'Génération des balances en cours...'
    
    // Démarrer le stream de logs
    if (data.processId) {
      startLogsStream(data.processId)
    }
    
    // Attendre un peu puis recharger les fichiers
    setTimeout(() => {
      loadFiles()
    }, 3000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur inconnue'
    stopLogsStream()
  } finally {
    // Ne pas mettre isLoading à false immédiatement, on attend la fin du processus
  }
}

const generatePowerVoting = async () => {
  isLoading.value = true
  error.value = ''
  success.value = ''

  try {
    const response = await fetch(`${API_BASE}/generate/power-voting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) throw new Error('Erreur lors de la génération')

    success.value = 'Génération du power voting en cours...'
    
    setTimeout(() => {
      loadFiles()
    }, 3000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur inconnue'
  } finally {
    isLoading.value = false
  }
}

const rebuildCalculator = async () => {
  isRebuilding.value = true
  error.value = ''
  success.value = ''

  try {
    const response = await fetch(`${API_BASE}/rebuild`, {
      method: 'POST',
    })

    if (!response.ok) throw new Error('Erreur lors du rebuild')

    success.value = 'Rebuild terminé avec succès'
    
    setTimeout(() => {
      loadFiles()
    }, 2000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur inconnue'
  } finally {
    isRebuilding.value = false
  }
}

const deleteFile = async (filename: string) => {
  if (!confirm(`Êtes-vous sûr de vouloir supprimer ${filename} ?`)) return

  try {
    const response = await fetch(`${API_BASE}/files/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    })

    if (!response.ok) throw new Error('Erreur lors de la suppression')

    success.value = 'Fichier supprimé'
    loadFiles()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur inconnue'
  }
}

const useFile = async (file: { name: string; url: string }) => {
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
      data = new Promise((resolve, reject) => {
        Papa.parse(text, {
          header: true,
          dynamicTyping: false,
          skipEmptyLines: true,
          complete: (results) => {
            try {
              if (file.name.includes('balancesREG')) {
                const transformed = transformCSVToJSON(results.data as any[])
                resolve({ result: { balances: transformed } })
              } else if (file.name.includes('powerVoting')) {
                const transformed = transformPowerVotingCSV(results.data as any[])
                resolve({ result: { powerVoting: transformed } })
              } else {
                resolve({ result: results.data })
              }
            } catch (err) {
              reject(err)
            }
          },
          error: (err) => reject(err),
        })
      })
      data = await data
    } else {
      throw new Error('Format de fichier non supporté')
    }

    if (file.name.includes('balancesREG')) {
      dataStore.setBalancesData(data)
    } else if (file.name.includes('powerVoting')) {
      dataStore.setPowerVotingData(data)
    }

    router.push('/')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur inconnue'
  } finally {
    isLoading.value = false
  }
}

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

const formatDate = (date: Date) => {
  return new Date(date).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const detectPrompt = (message: string) => {
  const trimmed = message.trim()
  
  // Détecter les prompts de type select (avec "Use arrow keys" ou "Quelle tâche")
  if (trimmed.includes('?') && (trimmed.includes('Use arrow keys') || trimmed.includes('Quelle tâche') || trimmed.includes('askTask'))) {
    // Extraire la question
    const questionMatch = trimmed.match(/(.+?)\?/)
    const question = questionMatch ? questionMatch[1] + '?' : trimmed
    pendingPrompt.value = {
      type: 'select',
      question: question,
      options: [],
    }
    return
  }
  
  // Détecter les options de sélection (lignes avec ❯ ou qui sont des options valides)
  if (pendingPrompt.value?.type === 'select') {
    // Ignorer les lignes de contrôle inquirer
    if (trimmed.includes('Use arrow keys') || trimmed.includes('[?25') || trimmed.includes('G[') || trimmed.length === 0) {
      return
    }
    
    // Détecter une option (peut commencer par ❯, des espaces, ou être directement le nom)
    const option = trimmed.replace(/^[❯\s>]+/, '').replace(/\[.*?\]/g, '').trim()
    
    // Vérifier que c'est une option valide (pas un code ANSI ou une commande)
    if (option && 
        option.length > 0 && 
        !option.startsWith('\x1b') && 
        !option.match(/^\d+$/) && // Pas juste un nombre
        !pendingPrompt.value.options?.includes(option)) {
      pendingPrompt.value.options = [...(pendingPrompt.value.options || []), option]
    }
    return
  }
  
  // Détecter les prompts de confirmation (Y/n)
  if (trimmed.includes('?') && (trimmed.includes('(Y/n)') || trimmed.includes('(y/N)') || trimmed.includes('(yes/no)'))) {
    const questionMatch = trimmed.match(/(.+?)\?/)
    const question = questionMatch ? questionMatch[1] + '?' : trimmed
    pendingPrompt.value = {
      type: 'confirm',
      question: question,
      default: trimmed.includes('(Y/n)') || trimmed.includes('(yes)'),
    }
    // Pré-remplir avec la valeur par défaut
    promptAnswer.value = pendingPrompt.value.default ? 'y' : 'n'
    return
  }
  
  // Détecter les prompts d'input (question simple avec ?)
  if (trimmed.includes('?') && 
      !trimmed.includes('Use arrow keys') && 
      !trimmed.includes('(Y/n)') && 
      !trimmed.includes('(y/N)') &&
      !trimmed.includes('[?25') &&
      !pendingPrompt.value) {
    const questionMatch = trimmed.match(/(.+?)\?/)
    const question = questionMatch ? questionMatch[1] + '?' : trimmed
    pendingPrompt.value = {
      type: 'input',
      question: question,
    }
    return
  }
}

const sendPromptAnswer = async () => {
  if (!currentProcessId.value || !pendingPrompt.value) return
  
  let answer = ''
  
  if (pendingPrompt.value.type === 'select') {
    answer = promptAnswer.value
  } else if (pendingPrompt.value.type === 'confirm') {
    answer = promptAnswer.value === 'true' || promptAnswer.value === 'y' || promptAnswer.value === 'Y' ? 'y' : 'n'
  } else {
    answer = promptAnswer.value
  }
  
  try {
    const response = await fetch(`${API_BASE}/generate/balances/answer/${currentProcessId.value}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer }),
    })
    
    if (response.ok) {
      pendingPrompt.value = null
      promptAnswer.value = ''
      balancesLogs.value.push({
        type: 'info',
        message: `📤 Réponse envoyée: ${answer}`,
        timestamp: new Date().toISOString(),
      })
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors de l\'envoi de la réponse'
  }
}

onMounted(() => {
  loadFiles()
  // Recharger les fichiers toutes les 5 secondes
  setInterval(loadFiles, 5000)
})

// Nettoyer les EventSource à la destruction du composant
onUnmounted(() => {
  stopLogsStream()
})
</script>

<template>
  <div class="generate-view">
    <div class="generate-card">
      <div class="card-header">
        <h2>⚙️ Génération des données</h2>
        <p>Générez des balances REG et du power voting en utilisant balance-calculator</p>
      </div>

      <div class="actions-section">
        <div class="action-group">
          <h3>Génération</h3>
          <div class="button-group">
            <button
              @click="openBalancesModal"
              :disabled="isLoading"
              class="btn btn-primary"
            >
              <span v-if="!isLoading">📊 Générer Balances REG</span>
              <span v-else class="loading">⏳ Génération...</span>
            </button>

            <button
              @click="generatePowerVoting"
              :disabled="isLoading"
              class="btn btn-primary"
            >
              <span v-if="!isLoading">⚡ Générer Power Voting</span>
              <span v-else class="loading">⏳ Génération...</span>
            </button>
          </div>
        </div>

        <div class="action-group">
          <h3>Maintenance</h3>
          <button
            @click="rebuildCalculator"
            :disabled="isRebuilding"
            class="btn btn-secondary"
          >
            <span v-if="!isRebuilding">🔄 Rebuild balance-calculator</span>
            <span v-else class="loading">⏳ Rebuild en cours...</span>
          </button>
        </div>
      </div>

      <div v-if="error" class="error-message">⚠️ {{ error }}</div>
      <div v-if="success" class="success-message">✅ {{ success }}</div>
    </div>

    <!-- Modale pour la génération des balances -->
    <div v-if="showBalancesModal" class="modal-overlay" @click.self="closeBalancesModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>⚙️ Configuration - Génération Balances REG</h3>
          <button @click="closeBalancesModal" class="modal-close">×</button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label>Réseaux</label>
            <div class="checkbox-group">
              <label v-for="network in availableNetworks" :key="network" class="checkbox-label">
                <input
                  type="checkbox"
                  :value="network"
                  v-model="balancesParams.networks"
                />
                <span>{{ network }}</span>
              </label>
            </div>
          </div>

          <div v-for="network in balancesParams.networks" :key="network" class="form-group">
            <label>DEX pour {{ network }}</label>
            <div v-if="availableDexs[network] && availableDexs[network].length > 0" class="checkbox-group">
              <label v-for="dex in availableDexs[network]" :key="dex" class="checkbox-label">
                <input
                  type="checkbox"
                  :value="dex"
                  v-model="balancesParams.dexs[network]"
                />
                <span>{{ dex }}</span>
              </label>
            </div>
            <p v-else class="text-muted">Aucun DEX disponible pour ce réseau</p>
          </div>

          <div class="form-group">
            <label>Date de début</label>
            <input type="date" v-model="balancesParams.startDate" class="form-input" />
          </div>

          <div class="form-group">
            <label>Date de fin</label>
            <input type="date" v-model="balancesParams.endDate" class="form-input" />
          </div>

          <div class="form-group">
            <label>Heure du snapshot (HH:MM)</label>
            <input type="time" v-model="balancesParams.snapshotTime" class="form-input" />
          </div>

          <div class="form-group">
            <label>Adresse cible</label>
            <input
              type="text"
              v-model="balancesParams.targetAddress"
              placeholder="0x... ou 'all'"
              class="form-input"
            />
          </div>

          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="balancesParams.useMock" />
              <span>Utiliser des données mock</span>
            </label>
          </div>

          <!-- Zone de logs en temps réel -->
          <div class="form-group">
            <label>📋 Logs en temps réel</label>
            <div id="balances-logs-container" class="logs-container">
              <div
                v-for="(log, index) in balancesLogs"
                :key="index"
                class="log-line"
                :class="`log-${log.type}`"
              >
                <span class="log-timestamp">{{ new Date(log.timestamp).toLocaleTimeString('fr-FR') }}</span>
                <span class="log-message">{{ log.message }}</span>
              </div>
              <div v-if="balancesLogs.length === 0" class="log-empty">
                En attente des logs...
              </div>
            </div>
          </div>

          <!-- Prompt interactif -->
          <div v-if="pendingPrompt" class="prompt-container">
            <div class="prompt-header">
              <span>❓ Question interactive</span>
            </div>
            <div class="prompt-question">{{ pendingPrompt.question }}</div>
            
            <div v-if="pendingPrompt.type === 'select' && pendingPrompt.options && pendingPrompt.options.length > 0" class="prompt-options">
              <label
                v-for="(option, index) in pendingPrompt.options"
                :key="index"
                class="prompt-option"
              >
                <input
                  type="radio"
                  :value="option"
                  v-model="promptAnswer"
                  :name="'prompt-option'"
                />
                <span>{{ option }}</span>
              </label>
            </div>
            
            <div v-else-if="pendingPrompt.type === 'confirm'" class="prompt-options">
              <label class="prompt-option">
                <input type="radio" value="y" v-model="promptAnswer" name="prompt-confirm" />
                <span>Oui</span>
              </label>
              <label class="prompt-option">
                <input type="radio" value="n" v-model="promptAnswer" name="prompt-confirm" />
                <span>Non</span>
              </label>
            </div>
            
            <div v-else class="prompt-input">
              <input
                type="text"
                v-model="promptAnswer"
                @keyup.enter="sendPromptAnswer"
                class="form-input"
                placeholder="Tapez votre réponse..."
              />
            </div>
            
            <div class="prompt-actions">
              <button @click="sendPromptAnswer" :disabled="!promptAnswer" class="btn btn-primary btn-small">
                📤 Envoyer
              </button>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button @click="closeBalancesModal" class="btn btn-secondary">Annuler</button>
          <button @click="generateBalances" :disabled="isLoading" class="btn btn-primary">
            <span v-if="!isLoading">🚀 Générer</span>
            <span v-else class="loading">⏳ Génération...</span>
          </button>
        </div>
      </div>
    </div>

    <div class="files-section">
      <div class="files-header">
        <h3>📁 Fichiers générés ({{ files.length }})</h3>
        <button @click="loadFiles" class="btn-refresh">🔄 Actualiser</button>
      </div>

      <div v-if="files.length === 0" class="empty-state">
        <p>Aucun fichier généré pour le moment</p>
      </div>

      <div v-else class="files-list">
        <div
          v-for="file in files"
          :key="file.name"
          class="file-item"
        >
          <div class="file-info">
            <div class="file-name">{{ file.name }}</div>
            <div class="file-meta">
              <span>{{ formatFileSize(file.size) }}</span>
              <span>•</span>
              <span>{{ formatDate(file.modified) }}</span>
              <span>•</span>
              <span class="file-type">{{ file.type.toUpperCase() }}</span>
            </div>
          </div>
          <div class="file-actions">
            <button
              @click="useFile(file)"
              :disabled="isLoading"
              class="btn btn-small btn-primary"
            >
              📤 Utiliser
            </button>
            <button
              @click="deleteFile(file.name)"
              class="btn btn-small btn-danger"
            >
              🗑️ Supprimer
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.generate-view {
  animation: fadeIn 0.5s ease;
}

.generate-card {
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

.actions-section {
  display: grid;
  gap: 2rem;
  margin-bottom: 2rem;
}

.action-group h3 {
  font-size: 1.25rem;
  margin-bottom: 1rem;
  color: var(--text-primary);
}

.button-group {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.btn {
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

.btn-small {
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
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

.btn-danger {
  background: var(--error-color);
  color: white;
}

.btn-danger:hover {
  background: #dc2626;
  transform: translateY(-2px);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading {
  animation: pulse 1.5s ease-in-out infinite;
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

.success-message {
  padding: 1rem;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid var(--success-color);
  border-radius: 0.5rem;
  color: var(--success-color);
  margin-bottom: 1.5rem;
  animation: fadeIn 0.3s ease;
}

.files-section {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 2rem;
  box-shadow: var(--shadow-lg);
}

.files-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.files-header h3 {
  font-size: 1.5rem;
  color: var(--text-primary);
}

.btn-refresh {
  padding: 0.5rem 1rem;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.3s ease;
}

.btn-refresh:hover {
  background: var(--bg-secondary);
  border-color: var(--primary-color);
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: var(--text-muted);
}

.files-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.file-item {
  background: var(--glass-bg);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  padding: 1.25rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.3s ease;
}

.file-item:hover {
  border-color: var(--primary-color);
  background: var(--bg-tertiary);
  transform: translateX(4px);
  box-shadow: var(--shadow-md);
}

.file-info {
  flex: 1;
}

.file-name {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
  font-family: 'Courier New', monospace;
  font-size: 0.95rem;
}

.file-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-muted);
  flex-wrap: wrap;
}

.file-type {
  padding: 0.15rem 0.5rem;
  background: var(--bg-tertiary);
  border-radius: 0.25rem;
  font-weight: 600;
}

.file-actions {
  display: flex;
  gap: 0.5rem;
}

@media (max-width: 768px) {
  .generate-card {
    padding: 1.5rem;
  }

  .card-header h2 {
    font-size: 1.5rem;
  }

  .button-group {
    flex-direction: column;
  }

  .btn {
    width: 100%;
  }

  .file-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .file-actions {
    width: 100%;
    justify-content: flex-end;
  }
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.3s ease;
}

.modal-content {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  max-width: 800px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-xl);
  animation: slideIn 0.3s ease;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  margin: 0;
  color: var(--text-primary);
}

.modal-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 2rem;
  cursor: pointer;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  transition: all 0.3s ease;
}

.modal-close:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.modal-body {
  padding: 1.5rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  padding: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
  font-weight: 500;
}

.form-input {
  width: 100%;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 1rem;
  transition: all 0.3s ease;
}

.form-input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  color: var(--text-secondary);
}

.checkbox-label input[type="checkbox"] {
  width: 1.25rem;
  height: 1.25rem;
  cursor: pointer;
}

.text-muted {
  color: var(--text-muted);
  font-size: 0.875rem;
  font-style: italic;
}

.logs-container {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  padding: 1rem;
  max-height: 300px;
  overflow-y: auto;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
}

.log-line {
  display: flex;
  gap: 0.5rem;
  padding: 0.25rem 0;
  line-height: 1.4;
  word-break: break-word;
}

.log-timestamp {
  color: var(--text-muted);
  flex-shrink: 0;
  min-width: 80px;
}

.log-message {
  color: var(--text-secondary);
  flex: 1;
}

.log-line.log-info .log-message {
  color: var(--text-secondary);
}

.log-line.log-stdout .log-message {
  color: var(--text-primary);
}

.log-line.log-stderr .log-message {
  color: var(--error-color);
}

.log-line.log-success .log-message {
  color: var(--success-color);
}

.log-line.log-error .log-message {
  color: var(--error-color);
  font-weight: 600;
}

.log-empty {
  color: var(--text-muted);
  font-style: italic;
  text-align: center;
  padding: 2rem;
}

/* Prompt interactif */
.prompt-container {
  background: var(--bg-tertiary);
  border: 2px solid var(--primary-color);
  border-radius: 0.75rem;
  padding: 1.5rem;
  margin-top: 1rem;
  animation: slideIn 0.3s ease;
}

.prompt-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  font-weight: 600;
  color: var(--primary-color);
}

.prompt-question {
  margin-bottom: 1rem;
  color: var(--text-primary);
  font-weight: 500;
}

.prompt-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.prompt-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.3s ease;
}

.prompt-option:hover {
  border-color: var(--primary-color);
  background: var(--bg-secondary);
}

.prompt-option input[type="radio"] {
  width: 1.25rem;
  height: 1.25rem;
  cursor: pointer;
}

.prompt-option span {
  color: var(--text-primary);
  flex: 1;
}

.prompt-input {
  margin-bottom: 1rem;
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 768px) {
  .modal-content {
    width: 95%;
    max-height: 95vh;
  }
}
</style>

