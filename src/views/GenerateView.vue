<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDataStore } from '@/stores/dataStore'
import { transformCSVToJSON, transformPowerVotingCSV } from '@/utils/csvTransformer'
import Papa from 'papaparse'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

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
  type: 'select' | 'checkbox' | 'input' | 'confirm'
  question: string
  options?: string[]
} | null>(null)
const promptAnswer = ref<string>('')
const promptAnswers = ref<string[]>([]) // Pour les checkbox (sélection multiple)
const terminalInput = ref<string>('')
const terminalOutput = ref<HTMLElement | null>(null)
const terminalInputRef = ref<HTMLInputElement | null>(null)
const terminalContainer = ref<HTMLElement | null>(null)
const xtermTerminal = ref<Terminal | null>(null)
const fitAddon = ref<FitAddon | null>(null)

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

// Fonction supprimée - le modal s'ouvre maintenant directement depuis startBalanceCalculator

const closeBalancesModal = () => {
  // Ne pas fermer si un processus est en cours
  if (currentProcessId.value) {
    if (!confirm('Un processus est en cours. Voulez-vous vraiment fermer ? Les logs seront interrompus.')) {
      return
    }
  }
  stopLogsStream()
  showBalancesModal.value = false
  isLoading.value = false
  pendingPrompt.value = null
  promptAnswer.value = ''
  promptAnswers.value = []
}

// Fonction pour envoyer une commande au terminal
const sendTerminalInput = async () => {
  if (!currentProcessId.value) {
    return
  }
  
  const input = terminalInput.value.trim()
  
  // Si l'input est vide, on envoie juste Enter (pour valider une sélection avec les flèches)
  if (!input) {
    await sendKeyToProcess('\n', false) // false = ne pas afficher dans les logs
    return
  }
  
  // Afficher la commande dans le terminal (seulement pour les réponses textuelles)
  balancesLogs.value.push({
    type: 'info',
    message: `$ ${input}`,
    timestamp: new Date().toISOString(),
  })
  
  // Envoyer au serveur
  try {
    const response = await fetch(`${API_BASE}/balance-calculator/answer/${currentProcessId.value}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: input }),
    })
    
    if (!response.ok) {
      const errorData = await response.json()
      error.value = errorData.error || 'Erreur lors de l\'envoi de la commande'
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors de l\'envoi de la commande'
  }
  
  // Vider l'input
  terminalInput.value = ''
  
  // Faire défiler vers le bas
  setTimeout(() => {
    if (terminalOutput.value) {
      terminalOutput.value.scrollTop = terminalOutput.value.scrollHeight
    }
    // Remettre le focus sur l'input
    if (terminalInputRef.value) {
      terminalInputRef.value.focus()
    }
  }, 100)
}

// Gérer les touches spéciales dans le terminal
const handleTerminalKeydown = async (event: KeyboardEvent) => {
  if (!currentProcessId.value) {
    return
  }
  
  // Flèches pour naviguer dans les prompts inquirer
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    await sendKeyToProcess('\x1b[A') // Code ANSI pour flèche haut
    return
  }
  
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    await sendKeyToProcess('\x1b[B') // Code ANSI pour flèche bas
    return
  }
  
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    await sendKeyToProcess('\x1b[D') // Code ANSI pour flèche gauche
    return
  }
  
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    await sendKeyToProcess('\x1b[C') // Code ANSI pour flèche droite
    return
  }
  
  // Ctrl+C pour arrêter (optionnel)
  if (event.ctrlKey && event.key === 'c') {
    event.preventDefault()
    // TODO: Implémenter l'arrêt du processus
  }
}

// Fonction pour envoyer une touche spéciale au processus
const sendKeyToProcess = async (key: string, showInLogs = true) => {
  if (!currentProcessId.value) {
    return
  }
  
  try {
    const response = await fetch(`${API_BASE}/balance-calculator/answer/${currentProcessId.value}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: key }),
    })
    
    if (!response.ok) {
      const errorData = await response.json()
      console.error('Erreur lors de l\'envoi de la touche:', errorData.error)
    }
  } catch (err) {
    console.error('Erreur lors de l\'envoi de la touche:', err)
  }
  
  // Remettre le focus sur l'input après l'envoi d'une touche
  setTimeout(() => {
    if (terminalInputRef.value) {
      terminalInputRef.value.focus()
    }
  }, 50)
}

const sendPromptAnswer = async () => {
  // Ancienne fonction gardée pour compatibilité mais non utilisée
  // On utilise maintenant sendTerminalInput
  await sendTerminalInput()
}

const startLogsStream = (processId: string) => {
  // Fermer l'ancien stream s'il existe
  if (eventSource.value) {
    eventSource.value.close()
  }
  
  balancesLogs.value = []
  currentProcessId.value = processId
  terminalInput.value = ''
  
  // Créer un nouveau EventSource pour les logs
  eventSource.value = new EventSource(`${API_BASE}/balance-calculator/logs/${processId}`)
  
  // Focus sur le terminal xterm après un court délai
  setTimeout(() => {
    if (xtermTerminal.value) {
      xtermTerminal.value.focus()
    }
  }, 500)
  
  eventSource.value.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data)
      
      // Envoyer les logs à xterm.js au lieu de l'ancien système
      if (xtermTerminal.value) {
        if (log.type === 'stdout' || log.type === 'stderr' || log.type === 'info') {
          // Écrire directement dans le terminal xterm
          xtermTerminal.value.write(log.message + '\r\n')
        }
      } else {
        // Fallback vers l'ancien système si xterm n'est pas initialisé
        if (log.type !== 'prompt' && log.type !== 'prompt-completed') {
          balancesLogs.value.push(log)
        }
      }
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

const startBalanceCalculator = async () => {
  // Ouvrir le modal si ce n'est pas déjà fait
  if (!showBalancesModal.value) {
    showBalancesModal.value = true
    // Attendre que le modal soit monté avant d'initialiser xterm
    await nextTick()
    await initXterm()
  }
  
  isLoading.value = true
  error.value = ''
  success.value = ''
  balancesLogs.value = []
  pendingPrompt.value = null
  promptAnswer.value = ''
  promptAnswers.value = []
  terminalInput.value = ''

  try {
    const response = await fetch(`${API_BASE}/balance-calculator/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Erreur lors du lancement' }))
      throw new Error(errorData.error || 'Erreur lors du lancement')
    }

    const data = await response.json()
    success.value = data.message || 'Balance-calculator lancé...'
    
    // Démarrer le stream de logs
    if (data.processId) {
      startLogsStream(data.processId)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors du lancement'
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

// Fonction pour télécharger un fichier
const downloadFile = async (file: { name: string; url: string }) => {
  try {
    // file.url est déjà au format /generated/filename
    // En développement, Vite proxy vers le backend, donc on utilise directement l'URL
    // En production, l'URL sera relative et fonctionnera aussi
    const response = await fetch(file.url, {
      method: 'GET',
    })
    if (!response.ok) {
      throw new Error(`Erreur lors du téléchargement: ${response.status} ${response.statusText}`)
    }
    
    const blob = await response.blob()
    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(downloadUrl)
    
    success.value = `✅ Fichier ${file.name} téléchargé avec succès`
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors du téléchargement'
  }
}

// Ancienne fonction gardée pour compatibilité (non utilisée)
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


// Initialiser xterm.js
const initXterm = async () => {
  if (!terminalContainer.value || xtermTerminal.value) {
    return
  }
  
  await nextTick()
  
  const terminal = new Terminal({
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#4ec9b0',
      selection: '#264f78',
    },
    fontSize: 14,
    fontFamily: 'Courier New, monospace',
    cursorBlink: true,
    cursorStyle: 'block',
  })
  
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  
  terminal.open(terminalContainer.value)
  fit.fit()
  
  // Gérer les entrées utilisateur
  terminal.onData(async (data) => {
    if (!currentProcessId.value) {
      return
    }
    
    // Envoyer les données au backend
    try {
      await fetch(`${API_BASE}/balance-calculator/answer/${currentProcessId.value}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: data }),
      })
    } catch (err) {
      console.error('Erreur lors de l\'envoi des données:', err)
    }
  })
  
  xtermTerminal.value = terminal
  fitAddon.value = fit
  
  // Ajuster la taille quand la fenêtre change
  const resizeObserver = new ResizeObserver(() => {
    if (fitAddon.value) {
      fitAddon.value.fit()
    }
  })
  
  if (terminalContainer.value) {
    resizeObserver.observe(terminalContainer.value)
  }
}

// Nettoyer xterm.js
const cleanupXterm = () => {
  if (xtermTerminal.value) {
    xtermTerminal.value.dispose()
    xtermTerminal.value = null
    fitAddon.value = null
  }
}

// Surveiller l'ouverture du modal pour initialiser xterm
watch(showBalancesModal, async (isOpen) => {
  if (isOpen) {
    await nextTick()
    initXterm()
  } else {
    cleanupXterm()
  }
})

onMounted(() => {
  loadFiles()
  // Recharger les fichiers toutes les 5 secondes
  setInterval(loadFiles, 5000)
})

// Nettoyer les EventSource à la destruction du composant
onUnmounted(() => {
  stopLogsStream()
  cleanupXterm()
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
              @click="showBalancesModal = true"
              :disabled="isLoading"
              class="btn btn-primary"
            >
              <span v-if="!isLoading">🚀 Lancer balance-calculator</span>
              <span v-else class="loading">⏳ Lancement...</span>
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
          <h3>🚀 Balance-calculator - Mode interactif</h3>
          <button @click="closeBalancesModal" class="modal-close">×</button>
        </div>
        
        <div class="modal-body">
          <!-- Bouton pour lancer balance-calculator -->
          <div class="form-group" style="margin-bottom: 1.5rem;">
            <button
              @click="startBalanceCalculator"
              :disabled="isLoading || currentProcessId !== null"
              class="btn btn-primary"
              style="width: 100%;"
            >
              <span v-if="!isLoading && !currentProcessId">🚀 Lancer balance-calculator</span>
              <span v-else-if="isLoading">⏳ Lancement...</span>
              <span v-else>✅ Balance-calculator en cours d'exécution</span>
            </button>
          </div>

          <!-- Terminal interactif avec xterm.js -->
          <div class="form-group">
            <label>💻 Terminal interactif</label>
            <div 
              ref="terminalContainer" 
              class="xterm-terminal-container"
              style="width: 100%; height: 500px; background: #1e1e1e; border-radius: 0.5rem; padding: 1rem; overflow: hidden;"
            ></div>
          </div>

          <!-- Zone de prompt interactif (désactivée - on utilise le terminal maintenant) -->
          <div v-if="false && pendingPrompt" class="prompt-container">
            <div class="prompt-header">
              <span>💡 Question interactive</span>
            </div>
            <div class="prompt-question">{{ pendingPrompt.question }}</div>
            
            <div v-if="(pendingPrompt.type === 'select' || pendingPrompt.type === 'checkbox') && pendingPrompt.options && pendingPrompt.options.length > 0" class="prompt-options">
              <!-- Checkbox (sélection multiple) -->
              <template v-if="pendingPrompt.type === 'checkbox'">
                <label
                  v-for="(option, index) in pendingPrompt.options"
                  :key="index"
                  class="prompt-option"
                >
                  <input
                    type="checkbox"
                    :value="option"
                    v-model="promptAnswers"
                  />
                  <span>{{ option }}</span>
                </label>
              </template>
              <!-- Select (sélection unique) -->
              <template v-else>
                <label
                  v-for="(option, index) in pendingPrompt.options"
                  :key="index"
                  class="prompt-option"
                >
                  <input
                    type="radio"
                    :value="option"
                    v-model="promptAnswer"
                    name="prompt-option"
                  />
                  <span>{{ option }}</span>
                </label>
              </template>
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
            
            <div v-else-if="pendingPrompt.type === 'input'" class="prompt-input">
              <input
                type="text"
                v-model="promptAnswer"
                @keyup.enter="sendPromptAnswer"
                class="form-input"
                placeholder="Tapez votre réponse..."
              />
            </div>
            
            <div class="prompt-actions">
              <button @click="sendPromptAnswer" :disabled="pendingPrompt.type === 'checkbox' ? promptAnswers.length === 0 : !promptAnswer" class="btn btn-primary btn-small">
                📤 Envoyer
              </button>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button @click="closeBalancesModal" class="btn btn-secondary">Fermer</button>
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
              @click="downloadFile(file)"
              :disabled="isLoading"
              class="btn btn-small btn-primary"
            >
              ⬇️ Download
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

/* Terminal interactif */
.terminal-container {
  background: #1e1e1e;
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid var(--border-color);
  font-family: 'Courier New', monospace;
}

.terminal-output {
  height: 400px;
  overflow-y: auto;
  padding: 1rem;
  background: #1e1e1e;
  color: #d4d4d4;
  font-size: 0.875rem;
  line-height: 1.5;
}

.terminal-line {
  margin-bottom: 0.25rem;
  word-break: break-word;
}

.terminal-line.terminal-stdout {
  color: #d4d4d4;
}

.terminal-line.terminal-stderr {
  color: #f48771;
}

.terminal-line.terminal-info {
  color: #4ec9b0;
}

.terminal-line.terminal-success {
  color: #4ec9b0;
}

.terminal-line.terminal-error {
  color: #f48771;
  font-weight: 600;
}

.terminal-message {
  white-space: pre-wrap;
}

.terminal-empty {
  color: #858585;
  font-style: italic;
  text-align: center;
  padding: 2rem;
}

.terminal-input-container {
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  background: #252526;
  border-top: 1px solid var(--border-color);
}

.terminal-prompt {
  color: #4ec9b0;
  margin-right: 0.5rem;
  font-weight: 600;
}

.terminal-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #d4d4d4;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  outline: none;
}

.terminal-input::placeholder {
  color: #858585;
}

.terminal-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 768px) {
  .modal-content {
    width: 95%;
    max-height: 95vh;
  }
}
</style>

