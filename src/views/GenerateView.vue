<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDataStore } from '@/stores/dataStore'
import { transformCSVToJSON, transformPowerVotingCSV } from '@/utils/csvTransformer'
import { sessionHeaders } from '@/composables/useSessionId'
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
// Upload de fichiers
const isDraggingFiles = ref(false)
const isUploadingFiles = ref(false)
const uploadedFiles = ref<File[]>([])
// Références pour les intervalles (pour les nettoyer)
const filesInterval = ref<NodeJS.Timeout | null>(null)
const gitInfoInterval = ref<NodeJS.Timeout | null>(null)
const envLocalInterval = ref<NodeJS.Timeout | null>(null)
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
const terminalSectionRef = ref<HTMLElement | null>(null)
const xtermTerminal = ref<Terminal | null>(null)
const fitAddon = ref<FitAddon | null>(null)

// Refs pour la modale de rebuild
const showRebuildModal = ref(false)
const rebuildTerminalContainer = ref<HTMLElement | null>(null)
const rebuildXtermTerminal = ref<Terminal | null>(null)
const rebuildFitAddon = ref<FitAddon | null>(null)
const rebuildEventSource = ref<EventSource | null>(null)
const selectedRepository = ref<string>('https://github.com/RealToken-Community/balance-calculator.git')
const selectedBranch = ref<string>('yohann-test-pool-v3-modeles')
const availableBranches = ref<string[]>([])
const isLoadingBranches = ref(false)
const rebuildProcessId = ref<string | null>(null)

// Config pour optionsModifiers.ts
const optionsModifiersContent = ref<string>('')
const isLoadingConfig = ref(false)
const isSavingConfig = ref(false)
const showConfigSection = ref(false)

// Environnement pour .env
const envVariables = ref<Record<string, string>>({})
const isLoadingEnv = ref(false)
const isUpdatingEnv = ref<Record<string, boolean>>({})
const isUpdatingAllEnv = ref(false)
const showEnvSection = ref(false)
// Variables d'environnement requises (lignes 5-9 du .env)
const requiredEnvVars = [
  'THEGRAPH_API_KEY',
  'API_KEY_GNOSISSCAN',
  'API_KEY_ETHERSCAN',
  'API_KEY_POLYGONSCAN',
  'API_KEY_MORALIS'
]
// Vérification de .env.local
const envLocalCheck = ref<{
  exists: boolean
  hasAllRequiredVars: boolean
  missingVars: string[]
  foundVars: string[]
}>({
  exists: false,
  hasAllRequiredVars: false,
  missingVars: [],
  foundVars: []
})
const isLoadingEnvLocalCheck = ref(false)

// Infos Git de balance-calculator
const gitInfo = ref<{
  branch: string | null
  remote: string | null
  exists: boolean
  isGitRepo: boolean
}>({
  branch: null,
  remote: null,
  exists: false,
  isGitRepo: false,
})

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

const loadGitInfo = async () => {
  try {
    const response = await fetch(`${API_BASE}/balance-calculator/git-info`, { headers: sessionHeaders() })
    if (!response.ok) throw new Error('Erreur lors de la récupération des infos Git')
    gitInfo.value = await response.json()
  } catch (err) {
    console.error('Erreur lors du chargement des infos Git:', err)
    gitInfo.value = {
      branch: null,
      remote: null,
      exists: false,
      isGitRepo: false,
    }
  }
}

const fixPermissions = async () => {
  isLoading.value = true
  error.value = ''
  success.value = ''
  
  try {
    const response = await fetch(`${API_BASE}/balance-calculator/fix-permissions`, {
      method: 'POST',
      headers: sessionHeaders(),
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Erreur lors de la correction des permissions' }))
      throw new Error(errorData.error || 'Erreur lors de la correction des permissions')
    }
    
    const data = await response.json()
    success.value = data.message || 'Permissions corrigées avec succès'
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors de la correction des permissions'
  } finally {
    isLoading.value = false
  }
}

const checkEnvLocal = async () => {
  isLoadingEnvLocalCheck.value = true
  try {
    const response = await fetch(`${API_BASE}/env-local/check`)
    if (!response.ok) throw new Error('Erreur lors de la vérification de .env.local')
    envLocalCheck.value = await response.json()
  } catch (err) {
    console.error('Erreur lors de la vérification de .env.local:', err)
    envLocalCheck.value = {
      exists: false,
      hasAllRequiredVars: false,
      missingVars: requiredEnvVars,
      foundVars: []
    }
  } finally {
    isLoadingEnvLocalCheck.value = false
  }
}

const loadFiles = async () => {
  try {
    const response = await fetch(`${API_BASE}/files`, { headers: sessionHeaders() })
    if (!response.ok) throw new Error('Erreur lors du chargement des fichiers')
    files.value = await response.json()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur inconnue'
  }
}

// Gestion du drag and drop pour l'upload de fichiers
const handleDragOver = (event: DragEvent) => {
  event.preventDefault()
  event.stopPropagation()
  isDraggingFiles.value = true
}

const handleDragLeave = (event: DragEvent) => {
  event.preventDefault()
  event.stopPropagation()
  isDraggingFiles.value = false
}

const handleDrop = (event: DragEvent) => {
  event.preventDefault()
  event.stopPropagation()
  isDraggingFiles.value = false

  const droppedFiles = event.dataTransfer?.files
  if (droppedFiles && droppedFiles.length > 0) {
    const fileArray = Array.from(droppedFiles)
    // Filtrer seulement CSV et JSON
    const validFiles = fileArray.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      return ext === 'csv' || ext === 'json'
    })
    
    if (validFiles.length === 0) {
      error.value = 'Aucun fichier valide (CSV ou JSON) trouvé'
      return
    }
    
    if (validFiles.length < fileArray.length) {
      error.value = `${fileArray.length - validFiles.length} fichier(s) ignoré(s) (seulement CSV/JSON acceptés)`
    }
    
    uploadedFiles.value = validFiles
    uploadFiles()
  }
}

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  const selectedFiles = target.files
  if (selectedFiles && selectedFiles.length > 0) {
    const fileArray = Array.from(selectedFiles)
    const validFiles = fileArray.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      return ext === 'csv' || ext === 'json'
    })
    
    if (validFiles.length === 0) {
      error.value = 'Aucun fichier valide (CSV ou JSON) trouvé'
      return
    }
    
    uploadedFiles.value = validFiles
    uploadFiles()
  }
}

const uploadFiles = async () => {
  if (uploadedFiles.value.length === 0) {
    return
  }

  isUploadingFiles.value = true
  error.value = ''
  success.value = ''

  try {
    const formData = new FormData()
    uploadedFiles.value.forEach(file => {
      formData.append('files', file)
    })

    const response = await fetch(`${API_BASE}/files/upload`, {
      method: 'POST',
      headers: sessionHeaders(),
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Erreur lors de l\'upload' }))
      throw new Error(errorData.error || 'Erreur lors de l\'upload')
    }

    const data = await response.json()
    success.value = data.message || `${uploadedFiles.value.length} fichier(s) uploadé(s) avec succès`
    
    // Réinitialiser la liste des fichiers sélectionnés
    uploadedFiles.value = []
    
    // Rafraîchir la liste des fichiers
    setTimeout(() => {
      loadFiles()
    }, 500)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors de l\'upload'
  } finally {
    isUploadingFiles.value = false
  }
}

const loadOptionsModifiers = async () => {
  isLoadingConfig.value = true
  error.value = ''
  
  try {
    const response = await fetch(`${API_BASE}/balance-calculator/config/options-modifiers`, { headers: sessionHeaders() })
    const data = await response.json()
    
    // Si le fichier n'existe pas, c'est OK, on peut le créer
    if (!response.ok && response.status === 404) {
      optionsModifiersContent.value = ''
      error.value = data.error || 'Fichier non trouvé. Vous pouvez le créer en sauvegardant.'
      return
    }
    
    if (!response.ok) {
      throw new Error(data.error || 'Erreur lors du chargement de la configuration')
    }
    
    optionsModifiersContent.value = data.content || ''
    
    // Si le fichier n'existe pas mais que la réponse est OK avec un message d'erreur
    if (data.error && !data.content) {
      error.value = data.error
    }
  } catch (err) {
    console.error('Erreur lors du chargement de la configuration:', err)
    error.value = err instanceof Error ? err.message : 'Erreur lors du chargement de la configuration'
    optionsModifiersContent.value = ''
  } finally {
    isLoadingConfig.value = false
  }
}

const saveOptionsModifiers = async () => {
  isSavingConfig.value = true
  error.value = ''
  success.value = ''
  
  try {
    const response = await fetch(`${API_BASE}/balance-calculator/config/options-modifiers`, {
      method: 'POST',
      headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: optionsModifiersContent.value,
      }),
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Erreur lors de la sauvegarde' }))
      throw new Error(errorData.error || 'Erreur lors de la sauvegarde')
    }
    
    success.value = '✅ Configuration sauvegardée avec succès'
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors de la sauvegarde'
  } finally {
    isSavingConfig.value = false
  }
}

const loadEnv = async () => {
  isLoadingEnv.value = true
  error.value = ''
  
  try {
    const response = await fetch(`${API_BASE}/balance-calculator/config/env`, { headers: sessionHeaders() })
    
    // Vérifier le Content-Type avant de parser
    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text()
      console.error('Réponse non-JSON reçue:', text.substring(0, 200))
      throw new Error('Le serveur a retourné une réponse non-JSON. Vérifiez que l\'endpoint existe.')
    }
    
    const data = await response.json()
    
    // Si le fichier n'existe pas, c'est OK, on peut le créer
    if (!response.ok && response.status === 404) {
      // Initialiser avec des valeurs vides
      requiredEnvVars.forEach(key => {
        envVariables.value[key] = ''
        isUpdatingEnv.value[key] = false
      })
      error.value = data.error || 'Fichier .env non trouvé. Vous pouvez le créer en sauvegardant.'
      return
    }
    
    if (!response.ok) {
      throw new Error(data.error || 'Erreur lors du chargement de l\'environnement')
    }
    
    // Parser le contenu du .env et extraire uniquement les variables requises
    const content = data.content || ''
    const lines = content.split('\n')
    const parsedVars: Record<string, string> = {}
    
    // Initialiser toutes les variables requises avec des valeurs vides
    requiredEnvVars.forEach(key => {
      parsedVars[key] = ''
      isUpdatingEnv.value[key] = false
    })
    
    // Parser les lignes du .env
    lines.forEach(line => {
      const trimmed = line.trim()
      // Ignorer les commentaires et les lignes vides
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([^=]+)=(.*)$/)
        if (match) {
          const key = match[1].trim()
          let value = match[2].trim()
          // Retirer tous les guillemets (simples et doubles) de la valeur
          value = value.replace(/^["']+|["']+$/g, '').replace(/["']/g, '')
          // Ne garder que les variables requises
          if (requiredEnvVars.includes(key)) {
            parsedVars[key] = value
          }
        }
      }
    })
    
    envVariables.value = parsedVars
    
    // Si le fichier n'existe pas mais que la réponse est OK avec un message d'erreur
    if (data.error && !data.content) {
      error.value = data.error
    }
  } catch (err) {
    console.error('Erreur lors du chargement de l\'environnement:', err)
    error.value = err instanceof Error ? err.message : 'Erreur lors du chargement de l\'environnement'
    // Initialiser avec des valeurs vides en cas d'erreur
    requiredEnvVars.forEach(key => {
      envVariables.value[key] = ''
      isUpdatingEnv.value[key] = false
    })
  } finally {
    isLoadingEnv.value = false
  }
}

const updateEnvVariable = async (key: string) => {
  if (!key) {
    error.value = 'Clé de variable invalide'
    return
  }
  
  isUpdatingEnv.value[key] = true
  error.value = ''
  success.value = ''
  
  try {
    // Charger d'abord le contenu actuel du .env
    const loadResponse = await fetch(`${API_BASE}/balance-calculator/config/env`, { headers: sessionHeaders() })
    
    // Vérifier le Content-Type avant de parser
    const contentType = loadResponse.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      const text = await loadResponse.text()
      console.error('Réponse non-JSON reçue lors de la mise à jour:', text.substring(0, 200))
      throw new Error('Le serveur a retourné une réponse non-JSON. Vérifiez que l\'endpoint existe.')
    }
    
    const loadData = await loadResponse.json()
    
    let content = loadData.content || ''
    // Retirer tous les guillemets de la valeur avant de sauvegarder
    let value = (envVariables.value[key] || '').trim()
    // Retirer tous les guillemets (simples et doubles) de la valeur
    value = value.replace(/^["']+|["']+$/g, '').replace(/["']/g, '')
    
    // Si le fichier existe, remplacer la ligne de cette variable
    if (content) {
      const lines = content.split('\n')
      let found = false
      const updatedLines = lines.map(line => {
        const trimmed = line.trim()
        // Si c'est la ligne de cette variable, la remplacer (sans guillemets)
        // Utiliser une regex pour matcher la clé exacte, peu importe la valeur
        if (trimmed && !trimmed.startsWith('#')) {
          const lineMatch = trimmed.match(/^([^=]+)=(.*)$/)
          if (lineMatch) {
            const lineKey = lineMatch[1].trim()
            if (lineKey === key) {
              found = true
              return `${key}=${value}`
            }
          }
        }
        return line
      })
      
      // Si la variable n'existe pas dans le fichier, l'ajouter à la fin
      if (!found) {
        updatedLines.push(`${key}=${value}`)
      }
      
      content = updatedLines.join('\n')
    } else {
      // Créer un nouveau fichier avec cette variable
      content = `# Variables d'environnement pour balance-calculator\n# Généré automatiquement depuis l'interface\n\n${key}=${value}`
    }
    
    // Sauvegarder
    const saveResponse = await fetch(`${API_BASE}/balance-calculator/config/env`, {
      method: 'POST',
      headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: content,
      }),
    })
    
    if (!saveResponse.ok) {
      const errorData = await saveResponse.json().catch(() => ({ error: 'Erreur lors de la sauvegarde' }))
      throw new Error(errorData.error || 'Erreur lors de la sauvegarde')
    }
    
    success.value = `✅ Variable ${key} mise à jour avec succès`
    
    // Recharger pour afficher la valeur mise à jour dans le formulaire
    // Cela garantit que le formulaire reflète exactement ce qui est dans le .env
    setTimeout(() => {
      loadEnv()
    }, 300)
  } catch (err) {
    console.error('Erreur lors de la mise à jour de la variable:', err)
    error.value = err instanceof Error ? err.message : 'Erreur lors de la mise à jour'
  } finally {
    isUpdatingEnv.value[key] = false
  }
}

const updateAllEnvVariables = async () => {
  isUpdatingAllEnv.value = true
  error.value = ''
  success.value = ''
  
  try {
    // Charger d'abord le contenu actuel du .env
    const loadResponse = await fetch(`${API_BASE}/balance-calculator/config/env`, { headers: sessionHeaders() })
    
    // Vérifier le Content-Type avant de parser
    const contentType = loadResponse.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      const text = await loadResponse.text()
      console.error('Réponse non-JSON reçue lors de la mise à jour globale:', text.substring(0, 200))
      throw new Error('Le serveur a retourné une réponse non-JSON. Vérifiez que l\'endpoint existe.')
    }
    
    const loadData = await loadResponse.json()
    
    let content = loadData.content || ''
    const lines = content ? content.split('\n') : []
    const updatedLines: string[] = []
    const processedKeys = new Set<string>()
    
    // Parcourir les lignes existantes et remplacer les variables requises
    lines.forEach(line => {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const match = trimmed.match(/^([^=]+)=(.*)$/)
        if (match) {
          const key = match[1].trim()
          if (requiredEnvVars.includes(key)) {
            // Remplacer par la nouvelle valeur (sans guillemets)
            let value = (envVariables.value[key] || '').trim()
            // Retirer tous les guillemets (simples et doubles) de la valeur
            value = value.replace(/^["']+|["']+$/g, '').replace(/["']/g, '')
            updatedLines.push(`${key}=${value}`)
            processedKeys.add(key)
          } else {
            // Garder les autres variables telles quelles
            updatedLines.push(line)
          }
        } else {
          updatedLines.push(line)
        }
      } else {
        updatedLines.push(line)
      }
    })
    
    // Ajouter les variables requises qui n'existent pas encore (sans guillemets)
    requiredEnvVars.forEach(key => {
      if (!processedKeys.has(key)) {
        let value = (envVariables.value[key] || '').trim()
        // Retirer tous les guillemets (simples et doubles) de la valeur
        value = value.replace(/^["']+|["']+$/g, '').replace(/["']/g, '')
        updatedLines.push(`${key}=${value}`)
      }
    })
    
    content = updatedLines.join('\n')
    
    // Si le fichier était vide, ajouter un en-tête
    if (!loadData.content) {
      content = `# Variables d'environnement pour balance-calculator\n# Généré automatiquement depuis l'interface\n\n${content}`
    }
    
    // Sauvegarder
    const saveResponse = await fetch(`${API_BASE}/balance-calculator/config/env`, {
      method: 'POST',
      headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: content,
      }),
    })
    
    if (!saveResponse.ok) {
      const errorData = await saveResponse.json().catch(() => ({ error: 'Erreur lors de la sauvegarde' }))
      throw new Error(errorData.error || 'Erreur lors de la sauvegarde')
    }
    
    success.value = '✅ Toutes les variables d\'environnement mises à jour avec succès'
    
    // Recharger pour confirmer la mise à jour
    setTimeout(() => {
      loadEnv()
    }, 500)
  } catch (err) {
    console.error('Erreur lors de la mise à jour des variables:', err)
    error.value = err instanceof Error ? err.message : 'Erreur lors de la mise à jour'
  } finally {
    isUpdatingAllEnv.value = false
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
  success.value = ''
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
      headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
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

  eventSource.value.onopen = () => {
    if (xtermTerminal.value) {
      xtermTerminal.value.write('\r\n\x1b[32m● Connexion au flux de logs établie.\x1b[0m\r\n\r\n')
    }
  }

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
          // Écrire directement dans le terminal xterm avec les données brutes (codes ANSI inclus)
          // Ne pas ajouter \r\n car les données peuvent déjà contenir des codes de contrôle
          xtermTerminal.value.write(log.message)
          
          // Garder un peu d'espace en bas (environ 1/4 de la hauteur visible) pour éviter que les options soient cachées
          // On scroll légèrement vers le haut pour laisser de l'espace en bas
          setTimeout(() => {
            if (xtermTerminal.value) {
              const buffer = xtermTerminal.value.buffer.active
              const rows = xtermTerminal.value.rows
              // Calculer le nombre de lignes à garder visibles en bas (environ 1/4 de la hauteur = 25%)
              const linesToKeepVisible = Math.floor(rows * 0.25)
              // Calculer la position maximale de scroll pour garder l'espace en bas
              const totalLines = buffer.length
              const maxScrollPosition = Math.max(0, totalLines - rows + linesToKeepVisible)
              
              // Si on est trop bas, scroller vers le haut
              if (buffer.baseY > maxScrollPosition) {
                const linesToScrollUp = buffer.baseY - maxScrollPosition
                // Scroller vers le haut (valeur négative)
                xtermTerminal.value.scrollLines(-linesToScrollUp)
              }
            }
          }, 50)
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
  
  eventSource.value.onerror = () => {
    const es = eventSource.value
    if (es?.readyState === EventSource.CLOSED) {
      console.warn('EventSource logs fermé.')
      if (xtermTerminal.value) {
        xtermTerminal.value.write('\r\n\x1b[31m⚠ Connexion au flux de logs interrompue.\x1b[0m\r\n')
      }
    } else if (es?.readyState === EventSource.CONNECTING) {
      console.warn('EventSource logs en reconnexion…')
    }
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
  // Ouvrir la section terminal si ce n'est pas déjà fait
  if (!showBalancesModal.value) {
    showBalancesModal.value = true
    // Attendre que la section soit montée avant d'initialiser xterm
    await nextTick()
    await initXterm()
    // Scroller vers la section terminal
    await nextTick()
    terminalSectionRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
      headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Erreur lors du lancement' }))
      throw new Error(errorData.error || 'Erreur lors du lancement')
    }

    const data = await response.json()
    success.value = data.message || 'Balance-calculator lancé...'
    isLoading.value = false
    
    // Démarrer le stream de logs
    if (data.processId) {
      startLogsStream(data.processId)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur lors du lancement'
    isLoading.value = false
  }
}

const loadBranches = async (repositoryUrl: string) => {
  if (!repositoryUrl) {
    console.warn('Aucun repository URL fourni')
    return
  }
  
  isLoadingBranches.value = true
  availableBranches.value = []
  
  try {
    const response = await fetch(`${API_BASE}/repositories/branches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ repositoryUrl }),
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Erreur lors de la récupération des branches' }))
      throw new Error(errorData.error || 'Erreur lors de la récupération des branches')
    }
    
    const data = await response.json()
    availableBranches.value = data.branches || []
    
    // Si la branche par défaut existe, la sélectionner, sinon sélectionner la première
    if (availableBranches.value.includes('yohann-test-pool-v3-modeles')) {
      selectedBranch.value = 'yohann-test-pool-v3-modeles'
    } else if (availableBranches.value.includes('main')) {
      selectedBranch.value = 'main'
    } else if (availableBranches.value.length > 0) {
      selectedBranch.value = availableBranches.value[0]
    } else {
      // Aucune branche trouvée, utiliser la branche par défaut
      selectedBranch.value = 'yohann-test-pool-v3-modeles'
    }
  } catch (err) {
    console.error('Erreur lors du chargement des branches:', err)
    // En cas d'erreur, utiliser la branche par défaut
    selectedBranch.value = 'yohann-test-pool-v3-modeles'
    availableBranches.value = []
    error.value = err instanceof Error ? err.message : 'Erreur lors de la récupération des branches'
  } finally {
    isLoadingBranches.value = false
  }
}

const openRebuildModal = async (event?: Event) => {
  // Empêcher le comportement par défaut (rechargement de page)
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }
  
  showRebuildModal.value = true
  selectedRepository.value = 'https://github.com/RealToken-Community/balance-calculator.git'
  
  // Charger les branches du repository sélectionné
  await loadBranches(selectedRepository.value)
}

const closeRebuildModal = () => {
  showRebuildModal.value = false
  stopRebuildLogsStream()
  if (rebuildXtermTerminal.value) {
    rebuildXtermTerminal.value.dispose()
    rebuildXtermTerminal.value = null
  }
  if (rebuildFitAddon.value) {
    rebuildFitAddon.value = null
  }
  // Rafraîchir l’état Git et précharger la config dès la fermeture (clone peut d’être terminé)
  loadGitInfo()
}

const initRebuildXterm = async () => {
  if (!rebuildTerminalContainer.value || rebuildXtermTerminal.value) {
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
    allowProposedApi: true,
    allowTransparency: false,
    convertEol: true,
    disableStdin: false,
    scrollback: 1000,
  })
  
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  
  terminal.open(rebuildTerminalContainer.value)
  
  await nextTick()
  setTimeout(() => {
    fit.fit()
    terminal.refresh(0, terminal.rows - 1)
  }, 100)
  
  rebuildXtermTerminal.value = terminal
  rebuildFitAddon.value = fit
}

const startRebuildLogsStream = (processId: string) => {
  if (rebuildEventSource.value) {
    rebuildEventSource.value.close()
  }
  
  rebuildProcessId.value = processId
  rebuildEventSource.value = new EventSource(`${API_BASE}/rebuild/logs/${processId}`)
  
  rebuildEventSource.value.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data)
      
      if (rebuildXtermTerminal.value) {
        if (log.type === 'stdout' || log.type === 'stderr' || log.type === 'info' || log.type === 'error') {
          // S'assurer que chaque message se termine par un retour à la ligne
          let message = log.message
          // Si le message ne se termine pas déjà par \n ou \r\n, en ajouter un
          if (!message.endsWith('\n') && !message.endsWith('\r\n')) {
            message += '\r\n'
          }
          rebuildXtermTerminal.value.write(message)
          
          // Détecter la fin du rebuild et rafraîchir les infos Git et les fichiers
          // On attend que le stream soit complètement terminé avant de rafraîchir
          if (log.message.includes('✅ Rebuild terminé avec succès') || log.message.includes('Rebuild terminé')) {
            // Réactiver le bouton immédiatement pour permettre un nouveau rebuild
            isRebuilding.value = false
            rebuildProcessId.value = null
            // Fermer la modale automatiquement quand le clone/rebuild est terminé avec succès
            closeRebuildModal()
            
            // Attendre beaucoup plus longtemps pour que tous les logs soient envoyés et que le système de fichiers soit à jour
            // Ne pas rafraîchir immédiatement pour éviter de couper les logs
            setTimeout(() => {
              loadGitInfo()
              loadFiles() // Rafraîchir aussi la liste des fichiers générés
              checkEnvLocal() // Re-vérifier .env.local après le rebuild
            }, 15000) // Augmenter le délai à 15 secondes pour laisser le temps à tous les logs d'arriver
          }
        }
      }
    } catch (err) {
      console.error('Error parsing rebuild log:', err)
    }
  }
  
  rebuildEventSource.value.onerror = (err) => {
    console.error('Rebuild EventSource error:', err)
  }
}

const stopRebuildLogsStream = () => {
  if (rebuildEventSource.value) {
    rebuildEventSource.value.close()
    rebuildEventSource.value = null
  }
  rebuildProcessId.value = null
}

const rebuildCalculator = async (event?: Event) => {
  // Empêcher le comportement par défaut (rechargement de page)
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }
  
  // Nettoyer l'état précédent avant de lancer un nouveau rebuild
  stopRebuildLogsStream()
  isRebuilding.value = true
  error.value = ''
  success.value = ''

  try {
    // Initialiser le terminal si ce n'est pas déjà fait
    if (!rebuildXtermTerminal.value) {
      await initRebuildXterm()
    } else {
      // Nettoyer le terminal avant de lancer un nouveau rebuild
      rebuildXtermTerminal.value.clear()
      rebuildXtermTerminal.value.write('\r\n🔄 Nouveau rebuild en cours...\r\n\r\n')
    }
    
    // Lancer le rebuild avec le repository sélectionné
    const response = await fetch(`${API_BASE}/rebuild`, {
      method: 'POST',
      headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repositoryUrl: selectedRepository.value,
        branch: selectedBranch.value,
      }),
    })

    if (!response.ok) throw new Error('Erreur lors du rebuild')

    const data = await response.json()
    
    // Démarrer le stream de logs
    if (data.processId) {
      startRebuildLogsStream(data.processId)
    }
    
    // Rafraîchir les infos Git après un délai (pour laisser le temps au rebuild de se terminer)
    setTimeout(() => {
      loadGitInfo()
    }, 5000)
    
    // Attendre la fin du processus (détecté via les logs ou un message spécial)
    // Pour l'instant, on laisse l'utilisateur fermer la modale manuellement
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur inconnue'
    if (rebuildXtermTerminal.value) {
      rebuildXtermTerminal.value.write(`\r\n❌ Erreur: ${error.value}\r\n`)
    }
    // Réactiver le bouton en cas d'erreur pour permettre de réessayer
    isRebuilding.value = false
    rebuildProcessId.value = null
  }
}

// Watch pour initialiser le terminal quand la modale s'ouvre
watch(showRebuildModal, async (isOpen) => {
  if (isOpen) {
    await nextTick()
    await initRebuildXterm()
  } else {
    stopRebuildLogsStream()
    if (rebuildXtermTerminal.value) {
      rebuildXtermTerminal.value.dispose()
      rebuildXtermTerminal.value = null
    }
    if (rebuildFitAddon.value) {
      rebuildFitAddon.value = null
    }
  }
})

const deleteFile = async (filename: string) => {
  if (!confirm(`Êtes-vous sûr de vouloir supprimer ${filename} ?`)) return
  error.value = ''
  success.value = ''
  try {
    const response = await fetch(`${API_BASE}/files/delete`, {
      method: 'POST',
      headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || `Erreur ${response.status}`)
    }
    success.value = 'Fichier supprimé'
    await loadFiles()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erreur inconnue'
  }
}

// Fonction pour télécharger un fichier
const downloadFile = async (file: { name: string; url: string }) => {
  error.value = ''
  success.value = ''
  const absoluteUrl = file.url.startsWith('http') ? file.url : `${window.location.origin}${file.url}`
  try {
    const response = await fetch(absoluteUrl, {
      method: 'GET',
      credentials: 'include',
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
    try {
      const link = document.createElement('a')
      link.href = absoluteUrl
      link.download = file.name
      link.rel = 'noopener'
      link.target = '_blank'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      success.value = `✅ Téléchargement de ${file.name} lancé`
    } catch (fallbackErr) {
      error.value = err instanceof Error ? err.message : 'Erreur lors du téléchargement'
    }
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
    allowProposedApi: true,
    allowTransparency: false,
    convertEol: true, // Convertir \n en \r\n pour un meilleur rendu
    disableStdin: false,
    scrollback: 1000,
  })
  
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  
  terminal.open(terminalContainer.value)
  
  // Attendre un peu pour que le terminal soit complètement monté avant d'ajuster la taille
  await nextTick()
  setTimeout(() => {
    fit.fit()
    // Forcer un redraw pour s'assurer que tout est bien affiché
    terminal.refresh(0, terminal.rows - 1)
  }, 100)
  
  // Gérer les entrées utilisateur
  terminal.onData(async (data) => {
    if (!currentProcessId.value) {
      return
    }
    
    // Envoyer les données au backend
    // Les données sont envoyées telles quelles (xterm.js gère déjà les codes ANSI et les caractères spéciaux)
    // Le backend se chargera de distinguer les touches spéciales (flèches, espace, Enter)
    try {
      await fetch(`${API_BASE}/balance-calculator/answer/${currentProcessId.value}`, {
        method: 'POST',
        headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
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

// Surveiller la fermeture de la section pour nettoyer xterm
watch(showBalancesModal, (isOpen) => {
  if (!isOpen) {
    cleanupXterm()
  }
})

onMounted(() => {
  loadFiles()
  loadGitInfo()
  checkEnvLocal()
  // Recharger les fichiers toutes les 10 secondes (réduit de 5 à 10 pour moins de charge)
  filesInterval.value = setInterval(loadFiles, 10000)
  // Rafraîchir les infos Git toutes les 60 secondes (réduit de 30 à 60)
  gitInfoInterval.value = setInterval(() => {
    loadGitInfo()
  }, 60000)
  // Vérifier .env.local toutes les 60 secondes (réduit de 30 à 60)
  envLocalInterval.value = setInterval(() => {
    checkEnvLocal()
  }, 60000)
  // Charger la configuration et l'environnement si balance-calculator existe
  setTimeout(() => {
    if (gitInfo.value.exists && gitInfo.value.isGitRepo) {
      loadOptionsModifiers()
      // Ne charger l'environnement que si .env.local n'est pas utilisé
      if (!envLocalCheck.value.hasAllRequiredVars) {
        loadEnv()
      }
    }
  }, 2000)
})

// Watch pour charger la config dès que balance-calculator est cloné (préchargement automatique)
watch(() => gitInfo.value.exists && gitInfo.value.isGitRepo, (isReady) => {
  if (isReady) {
    loadOptionsModifiers()
    if (!envLocalCheck.value.hasAllRequiredVars) {
      loadEnv()
    }
  }
})

// Quand on ouvre la section Configuration, charger si le clone est prêt et le contenu vide
watch(showConfigSection, (isOpen) => {
  if (isOpen && gitInfo.value.exists && gitInfo.value.isGitRepo && !optionsModifiersContent.value) {
    loadOptionsModifiers()
  }
})

// Watch pour recharger l'environnement si .env.local change
watch(() => envLocalCheck.value.hasAllRequiredVars, (hasAll) => {
  if (!hasAll && showEnvSection.value && gitInfo.value.exists && gitInfo.value.isGitRepo) {
    loadEnv()
  }
})

// Nettoyer les EventSource et les intervalles à la destruction du composant
onUnmounted(() => {
  stopLogsStream()
  cleanupXterm()
  // Nettoyer tous les intervalles pour éviter les fuites mémoire et les requêtes multiples
  if (filesInterval.value) {
    clearInterval(filesInterval.value)
    filesInterval.value = null
  }
  if (gitInfoInterval.value) {
    clearInterval(gitInfoInterval.value)
    gitInfoInterval.value = null
  }
  if (envLocalInterval.value) {
    clearInterval(envLocalInterval.value)
    envLocalInterval.value = null
  }
})
</script>

<template>
  <div class="generate-view">
    <div class="generate-card">
      <div class="card-header">
        <h2>⚙️ Génération des données</h2>
        <p>Générez des balances REG et du power voting en utilisant balance-calculator</p>
      </div>

      <!-- Message par défaut quand aucun projet n'est détecté pour cette session -->
      <div
        v-if="!gitInfo.exists || !gitInfo.isGitRepo"
        class="no-project-banner"
        role="alert"
      >
        <span class="no-project-icon">📦</span>
        <div class="no-project-text">
          <strong>Aucun projet balance-calculator détecté pour cette session.</strong>
          <p style="margin: 0.5rem 0 0 0; font-size: 0.95rem; opacity: 0.95;">
            Cliquez sur <strong>« Rebuild balance-calculator »</strong> ci-dessous pour cloner le dépôt et commencer.
          </p>
        </div>
      </div>

      <div class="actions-section">
        <!-- Étape 1: Clone -->
        <div class="action-group">
          <h3><span class="step-number">1</span> Clone</h3>
          <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
          <button
            type="button"
            @click.prevent="openRebuildModal"
            class="btn btn-secondary"
          >
            🔄 Rebuild balance-calculator
          </button>
            <div v-if="gitInfo.exists && gitInfo.isGitRepo" style="display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; color: var(--text-secondary);">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="font-weight: 600;">Branche:</span>
                <span style="font-family: monospace; background: var(--card-bg); padding: 0.25rem 0.5rem; border-radius: 0.25rem; border: 1px solid var(--border-color);">
                  {{ gitInfo.branch || 'N/A' }}
                </span>
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="font-weight: 600;">Origin:</span>
                <span style="font-family: monospace; background: var(--card-bg); padding: 0.25rem 0.5rem; border-radius: 0.25rem; border: 1px solid var(--border-color); max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {{ gitInfo.remote || 'N/A' }}
                </span>
              </div>
            </div>
            <div v-else-if="gitInfo.exists && !gitInfo.isGitRepo" style="font-size: 0.875rem; color: #ffa500; font-style: italic;">
              ⚠️ Le dossier existe mais n'est pas un dépôt Git valide
            </div>
            <div v-else style="font-size: 0.875rem; color: var(--text-secondary); font-style: italic;">
              balance-calculator n'est pas encore cloné
            </div>
          </div>
        </div>

        <!-- Étapes 2–4 et lancement : affichés uniquement quand le projet est cloné -->
        <template v-if="gitInfo.exists && gitInfo.isGitRepo">
        <!-- Étape 2: Environnement -->
        <div class="action-group">
          <h3><span class="step-number">2</span> Environnement</h3>
          <div v-if="envLocalCheck.hasAllRequiredVars" style="padding: 1rem; background: rgba(16, 185, 129, 0.1); border: 1px solid var(--success-color); border-radius: 0.5rem; color: var(--success-color); margin-bottom: 1rem;">
            ✅ Les variables d'environnement sont gérées automatiquement depuis <code style="background: var(--card-bg); padding: 0.25rem 0.5rem; border-radius: 0.25rem;">.env.local</code>. Elles seront copiées dans balance-calculator lors du clone.
          </div>
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div style="display: flex; align-items: center; gap: 1rem;">
              <button
                type="button"
                @click.prevent="showEnvSection = !showEnvSection"
                :disabled="envLocalCheck.hasAllRequiredVars"
                class="btn btn-secondary"
                :title="envLocalCheck.hasAllRequiredVars ? 'Les variables sont gérées depuis .env.local' : ''"
              >
                {{ showEnvSection ? '▼' : '▶' }} {{ showEnvSection ? 'Masquer' : 'Afficher' }} l'environnement
              </button>
              <button
                v-if="showEnvSection"
                type="button"
                @click.prevent="loadEnv"
                :disabled="isLoadingEnv || envLocalCheck.hasAllRequiredVars"
                class="btn btn-secondary"
                :title="envLocalCheck.hasAllRequiredVars ? 'Les variables sont gérées depuis .env.local' : ''"
              >
                <span v-if="!isLoadingEnv">🔄 Recharger</span>
                <span v-else class="loading">⏳ Chargement...</span>
              </button>
            </div>
            
            <div v-if="showEnvSection && !envLocalCheck.hasAllRequiredVars" style="display: flex; flex-direction: column; gap: 1rem;">
              <div v-if="isLoadingEnv" style="color: var(--text-secondary); font-style: italic;">
                ⏳ Chargement de l'environnement...
              </div>
              <div v-else style="display: flex; flex-direction: column; gap: 1rem;">
                <div style="font-size: 0.875rem; color: var(--text-secondary);">
                  Variables d'environnement requises pour balance-calculator
                </div>
                <div style="display: flex; flex-direction: column; gap: 1rem;">
                  <div v-for="key in requiredEnvVars" :key="key" style="display: flex; align-items: center; gap: 1rem;">
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 0.25rem;">
                      <label :for="`env-${key}`" style="font-weight: 600; font-size: 0.875rem;">
                        {{ key }}
                      </label>
                      <input
                        :id="`env-${key}`"
                        v-model="envVariables[key]"
                        type="text"
                        class="form-input"
                        style="width: 100%; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-primary); font-family: 'Courier New', monospace;"
                        :placeholder="`Entrez la valeur pour ${key}`"
                      />
                    </div>
                    <button
                      type="button"
                      @click.prevent="updateEnvVariable(key)"
                      :disabled="isUpdatingEnv[key] || isUpdatingAllEnv"
                      class="btn btn-secondary"
                      style="margin-top: 1.5rem; white-space: nowrap;"
                    >
                      <span v-if="!isUpdatingEnv[key]">💾 Update</span>
                      <span v-else class="loading">⏳...</span>
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  @click.prevent="updateAllEnvVariables"
                  :disabled="isUpdatingAllEnv"
                  class="btn btn-primary"
                  style="width: 100%;"
                >
                  <span v-if="!isUpdatingAllEnv">💾 Update environnement variable global</span>
                  <span v-else class="loading">⏳ Mise à jour...</span>
                </button>
              </div>
            </div>
            <div v-else-if="showEnvSection && envLocalCheck.hasAllRequiredVars" style="padding: 1rem; background: var(--bg-tertiary); border-radius: 0.5rem; color: var(--text-secondary); font-style: italic;">
              Les variables d'environnement sont gérées depuis <code>.env.local</code> et seront automatiquement copiées lors du clone.
            </div>
          </div>
        </div>

        <!-- Étape 3: Configuration -->
        <div class="action-group">
          <h3><span class="step-number">3</span> Configuration</h3>
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div style="display: flex; align-items: center; gap: 1rem;">
              <button
                @click="showConfigSection = !showConfigSection"
                class="btn btn-secondary"
              >
                {{ showConfigSection ? '▼' : '▶' }} {{ showConfigSection ? 'Masquer' : 'Afficher' }} la configuration
              </button>
              <button
                v-if="showConfigSection"
                type="button"
                @click.prevent="loadOptionsModifiers"
                :disabled="isLoadingConfig"
                class="btn btn-secondary"
              >
                <span v-if="!isLoadingConfig">🔄 Recharger</span>
                <span v-else class="loading">⏳ Chargement...</span>
              </button>
            </div>
            
            <div v-if="showConfigSection" style="display: flex; flex-direction: column; gap: 1rem;">
              <div v-if="isLoadingConfig" style="color: var(--text-secondary); font-style: italic;">
                ⏳ Chargement de la configuration...
              </div>
              <div v-else style="display: flex; flex-direction: column; gap: 0.5rem;">
                <label style="font-weight: 600;">📝 optionsModifiers.ts</label>
                <textarea
                  v-model="optionsModifiersContent"
                  class="form-input"
                  style="width: 100%; min-height: 400px; font-family: 'Courier New', monospace; font-size: 0.875rem; padding: 1rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-primary); resize: vertical;"
                  placeholder="Le contenu du fichier optionsModifiers.ts apparaîtra ici..."
                ></textarea>
                <button
                  type="button"
                  @click.prevent="saveOptionsModifiers"
                  :disabled="isSavingConfig || !optionsModifiersContent"
                  class="btn btn-primary"
                >
                  <span v-if="!isSavingConfig">💾 Update config</span>
                  <span v-else class="loading">⏳ Sauvegarde...</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Étape 4: Lancer balance calculator -->
        <div class="action-group">
          <h3><span class="step-number">4</span> Lancer balance calculator</h3>
          <div class="button-group">
            <button
              type="button"
              @click="startBalanceCalculator"
              :disabled="isLoading"
              class="btn btn-primary"
            >
              <span v-if="!isLoading">🚀 Lancer balance-calculator</span>
              <span v-else class="loading">⏳ Lancement...</span>
            </button>
          </div>
        </div>
        </template>
      </div>

      <div v-if="error" class="error-message">⚠️ {{ error }}</div>
      <div v-if="success" class="success-message">✅ {{ success }}</div>
    </div>

    <!-- Section terminal balance-calculator (inline, pleine largeur) -->
    <div v-if="showBalancesModal" ref="terminalSectionRef" class="terminal-inline-section">
      <div class="terminal-inline-header">
        <h3>🚀 Balance-calculator - Mode interactif</h3>
        <button type="button" @click="closeBalancesModal" class="modal-close">×</button>
      </div>

      <!-- Notif visible : Balance-calculator lancé... (en cours d'exécution dans le terminal ci-dessous) -->
      <div v-if="success && currentProcessId" class="terminal-section-notif">
        ✅ {{ success }} <span class="terminal-section-notif-parens">(en cours d'exécution dans le terminal ci-dessous)</span>
      </div>

      <div class="terminal-inline-body">
        <!-- Aide rapide pour le terminal interactif -->
        <div class="terminal-help">
          <span class="terminal-help-item"><kbd>↑</kbd><kbd>↓</kbd> Naviguer</span>
          <span class="terminal-help-item"><kbd>Espace</kbd> Activer / Désactiver une option</span>
          <span class="terminal-help-item"><kbd>Entrée</kbd> Valider</span>
        </div>

        <!-- Terminal interactif avec xterm.js -->
        <div class="form-group" style="margin-bottom: 0;">
          <div
            ref="terminalContainer"
            class="xterm-terminal-container"
            style="width: 100%; height: 600px; background: #1e1e1e; border-radius: 0.5rem; padding: 1rem; overflow: hidden;"
          ></div>
        </div>
      </div>

      <div class="terminal-inline-footer">
        <span v-if="isLoading" class="loading-indicator">⏳ Lancement...</span>
        <span v-else-if="currentProcessId" class="running-indicator">
          ✅ Balance-calculator en cours d'exécution
          <span class="running-notif">({{ success || 'lancé' }})</span>
        </span>
        <button type="button" @click="closeBalancesModal" class="btn btn-secondary">Fermer</button>
      </div>
    </div>

    <!-- Modale pour le rebuild de balance-calculator -->
    <div v-if="showRebuildModal" class="modal-overlay" @click.self="closeRebuildModal">
      <div class="modal-content" style="max-width: 900px;">
        <div class="modal-header">
          <h3>🔄 Rebuild balance-calculator</h3>
          <button @click="closeRebuildModal" class="modal-close">×</button>
        </div>
        
        <div class="modal-body">
          <!-- Formulaire de choix du repository -->
          <div class="form-group" style="margin-bottom: 1.5rem;">
            <label>📦 Repository source</label>
            <div class="prompt-options" style="flex-direction: column; gap: 0.5rem;">
              <label class="prompt-option">
                <input 
                  type="radio" 
                  value="https://github.com/RealToken-Community/balance-calculator.git"
                  v-model="selectedRepository"
                  name="repository"
                  @change="loadBranches(selectedRepository)"
                />
                <span>RealToken-Community/balance-calculator</span>
              </label>
              <label class="prompt-option">
                <input 
                  type="radio" 
                  value="https://github.com/real-token/balance-calculator.git"
                  v-model="selectedRepository"
                  name="repository"
                  @change="loadBranches(selectedRepository)"
                />
                <span>real-token/balance-calculator</span>
              </label>
            </div>
          </div>

          <!-- Formulaire de choix de la branche -->
          <div class="form-group" style="margin-bottom: 1.5rem;">
            <label>🌿 Branche</label>
            <div v-if="isLoadingBranches" style="color: var(--text-secondary); font-style: italic;">
              ⏳ Chargement des branches...
            </div>
            <select 
              v-else-if="availableBranches.length > 0"
              v-model="selectedBranch"
              class="form-input"
              style="width: 100%; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-primary);"
            >
              <option v-for="branch in availableBranches" :key="branch" :value="branch">
                {{ branch }}
              </option>
            </select>
            <div v-else style="color: var(--text-secondary); font-style: italic;">
              <div v-if="error">⚠️ {{ error }}</div>
              <div v-else>Aucune branche disponible. La branche par défaut sera utilisée.</div>
            </div>
          </div>

          <!-- Terminal pour les logs du rebuild -->
          <div class="form-group">
            <label>📋 Logs du rebuild</label>
            <div 
              ref="rebuildTerminalContainer" 
              class="xterm-terminal-container"
              style="width: 100%; height: 500px; background: #1e1e1e; border-radius: 0.5rem; padding: 1rem; overflow: hidden;"
            ></div>
          </div>

          <!-- Bouton pour lancer le rebuild -->
          <div class="form-group" style="margin-top: 1.5rem;">
            <button
              type="button"
              @click.prevent="rebuildCalculator"
              :disabled="isRebuilding || rebuildProcessId !== null"
              class="btn btn-primary"
              style="width: 100%;"
            >
              <span v-if="!isRebuilding && !rebuildProcessId">🚀 Lancer le rebuild</span>
              <span v-else-if="isRebuilding">⏳ Lancement...</span>
              <span v-else>✅ Rebuild en cours...</span>
            </button>
          </div>
        </div>

        <div class="modal-footer">
          <button @click="closeRebuildModal" class="btn btn-secondary">Fermer</button>
        </div>
      </div>
    </div>

    <!-- Zone de drag and drop pour uploader des fichiers -->
    <div v-if="gitInfo.exists && gitInfo.isGitRepo" class="upload-files-section">
      <div class="upload-files-card">
        <h3>📤 Uploader des fichiers vers outDatas</h3>
        <p style="color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 1rem;">
          Glissez-déposez ou sélectionnez des fichiers CSV/JSON pour les copier dans balance-calculator/outDatas
        </p>
        <div class="info-bubble" style="margin-bottom: 1rem; padding: 1rem; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 0.5rem; color: var(--text-primary);">
          <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
            <span style="font-size: 1.25rem; flex-shrink: 0;">ℹ️</span>
            <div style="flex: 1;">
              <strong style="color: rgba(59, 130, 246, 1);">Normalisation des noms de fichiers</strong>
              <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem; line-height: 1.5;">
                Pour que les fichiers soient correctement reconnus et traités par balance-calculator, les noms doivent contenir les mots-clés suivants :
                <br />• <strong style="color: rgba(59, 130, 246, 1);">balancesREG_</strong> : pour les fichiers de balances REG (avec underscore)
                <br />• <strong style="color: rgba(59, 130, 246, 1);">powerVotingREG</strong> : pour les fichiers de power voting (avec REG à la fin)
              </p>
            </div>
          </div>
        </div>
        <div
          class="upload-dropzone"
          :class="{ 'dragging': isDraggingFiles, 'uploading': isUploadingFiles }"
          @dragover.prevent="handleDragOver"
          @dragleave.prevent="handleDragLeave"
          @drop.prevent="handleDrop"
        >
          <div v-if="isUploadingFiles" class="upload-status">
            <span class="loading">⏳ Upload en cours...</span>
          </div>
          <div v-else class="upload-content">
            <div class="upload-icon">📁</div>
            <div class="upload-text">
              <strong>Glissez-déposez vos fichiers ici</strong>
              <span>ou</span>
              <label for="file-upload-input" class="upload-link">cliquez pour sélectionner</label>
              <input
                id="file-upload-input"
                type="file"
                multiple
                accept=".csv,.json"
                @change="handleFileSelect"
                style="display: none;"
              />
            </div>
            <div class="upload-hint">
              Formats acceptés: CSV, JSON (max 50MB par fichier)
            </div>
          </div>
        </div>
        <div v-if="uploadedFiles.length > 0 && !isUploadingFiles" class="uploaded-files-preview">
          <div class="preview-title">Fichiers sélectionnés ({{ uploadedFiles.length }})</div>
          <div class="preview-files">
            <div v-for="file in uploadedFiles" :key="file.name" class="preview-file">
              <span>📄 {{ file.name }}</span>
              <span class="preview-size">({{ formatFileSize(file.size) }})</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="gitInfo.exists && gitInfo.isGitRepo" class="files-section">
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
              type="button"
              @click.prevent="downloadFile(file)"
              :disabled="isLoading"
              class="btn btn-small btn-primary"
            >
              ⬇️ Download
            </button>
            <button
              type="button"
              @click.prevent="deleteFile(file.name)"
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

.no-project-banner {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.5rem;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(99, 102, 241, 0.12));
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 0.75rem;
  color: var(--text-primary);
}

.no-project-icon {
  font-size: 1.75rem;
  flex-shrink: 0;
}

.no-project-text {
  flex: 1;
  font-size: 1rem;
  line-height: 1.5;
}

.no-project-text strong {
  color: rgba(59, 130, 246, 1);
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
  background: var(--primary-color);
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
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  background: var(--primary-color);
  color: white;
  border-radius: 50%;
  font-weight: 700;
  font-size: 1rem;
  flex-shrink: 0;
  box-shadow: var(--shadow-md);
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

.upload-files-section {
  margin-bottom: 2rem;
}

.upload-files-card {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 2rem;
  box-shadow: var(--shadow-lg);
}

.upload-files-card h3 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

.upload-dropzone {
  border: 2px dashed var(--border-color);
  border-radius: 0.75rem;
  padding: 3rem 2rem;
  text-align: center;
  transition: all 0.3s ease;
  background: var(--glass-bg);
  cursor: pointer;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-dropzone:hover {
  border-color: var(--primary-color);
  background: var(--bg-tertiary);
}

.upload-dropzone.dragging {
  border-color: var(--primary-color);
  border-style: solid;
  background: rgba(99, 102, 241, 0.1);
  transform: scale(1.02);
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.3);
}

.upload-dropzone.uploading {
  opacity: 0.7;
  cursor: not-allowed;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.upload-icon {
  font-size: 3rem;
}

.upload-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-primary);
}

.upload-text strong {
  font-size: 1.1rem;
}

.upload-text span {
  color: var(--text-secondary);
}

.upload-link {
  color: var(--primary-color);
  cursor: pointer;
  text-decoration: underline;
  transition: color 0.3s ease;
}

.upload-link:hover {
  color: var(--secondary-color);
}

.upload-hint {
  font-size: 0.875rem;
  color: var(--text-muted);
  margin-top: 0.5rem;
}

.upload-status {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
  font-size: 1.1rem;
}

.uploaded-files-preview {
  margin-top: 1.5rem;
  padding: 1rem;
  background: var(--bg-tertiary);
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
}

.preview-title {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
  font-size: 0.95rem;
}

.preview-files {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.preview-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem;
  background: var(--bg-secondary);
  border-radius: 0.25rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.preview-size {
  color: var(--text-muted);
  font-size: 0.8rem;
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

/* Section terminal inline (remplace la modale pour balance-calculator) */
.terminal-inline-section {
  margin-top: 2rem;
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-xl);
  animation: fadeIn 0.3s ease;
}

.terminal-inline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.terminal-inline-header h3 {
  margin: 0;
  color: var(--text-primary);
}

.terminal-section-notif {
  padding: 0.75rem 1.5rem;
  margin: 0 1.5rem;
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.4);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 1rem;
}

.terminal-section-notif-parens {
  color: var(--primary-color);
  font-weight: 500;
}

.terminal-inline-body {
  padding: 1.5rem;
}

.terminal-inline-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.loading-indicator {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.running-indicator {
  font-size: 0.95rem;
  color: var(--text-primary);
}

.running-indicator .running-notif {
  color: var(--primary-color);
  font-weight: 500;
  margin-left: 0.25rem;
}

.terminal-help {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 0.75rem;
  padding: 0.6rem 0.9rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.terminal-help-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.terminal-help kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.15rem 0.45rem;
  background: var(--primary-color);
  border: 1px solid var(--primary-dark);
  border-bottom-width: 2px;
  border-radius: 0.3rem;
  font-family: inherit;
  font-size: 0.75rem;
  color: #111;
  white-space: nowrap;
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

