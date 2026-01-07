import express from 'express';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { existsSync, readFileSync } from 'fs';
import dotenv from 'dotenv';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const balanceCalculatorPath = path.join(projectRoot, 'balance-calculator');
const outDatasPath = path.join(balanceCalculatorPath, 'outDatas');

const app = express();
app.use(cors());
app.use(express.json());

// Créer le dossier outDatas s'il n'existe pas
fs.mkdir(outDatasPath, { recursive: true }).catch(console.error);

// Middleware pour servir les fichiers générés
app.use('/generated', express.static(outDatasPath));

// Lister les fichiers générés
app.get('/api/files', async (req, res) => {
  try {
    // Vérifier que balance-calculator existe
    if (!existsSync(balanceCalculatorPath)) {
      console.warn(`balance-calculator n'existe pas encore à ${balanceCalculatorPath}`);
      return res.json([]); // Retourner un tableau vide si balance-calculator n'existe pas
    }
    
    // Créer le dossier outDatas s'il n'existe pas
    try {
      await fs.mkdir(outDatasPath, { recursive: true });
    } catch (mkdirError) {
      console.error(`Erreur lors de la création du dossier outDatas: ${mkdirError.message}`);
      return res.status(500).json({ error: `Impossible de créer le dossier outDatas: ${mkdirError.message}` });
    }
    
    // Vérifier que le dossier existe
    if (!existsSync(outDatasPath)) {
      return res.status(500).json({ error: 'Impossible de créer le dossier outDatas' });
    }
    
    let files;
    try {
      files = await fs.readdir(outDatasPath);
    } catch (readError) {
      console.error(`Erreur lors de la lecture du dossier outDatas: ${readError.message}`);
      return res.status(500).json({ error: `Impossible de lire le dossier outDatas: ${readError.message}` });
    }
    
    // Filtrer les fichiers cachés et les dossiers
    const validFiles = files.filter(file => {
      const filePath = path.join(outDatasPath, file);
      return existsSync(filePath) && !file.startsWith('.');
    });
    
    const fileStats = await Promise.all(
      validFiles.map(async (file) => {
        try {
          const filePath = path.join(outDatasPath, file);
          const stats = await fs.stat(filePath);
          
          // Ignorer les dossiers
          if (stats.isDirectory()) {
            return null;
          }
          
          return {
            name: file,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            type: path.extname(file).slice(1) || 'unknown',
            url: `/generated/${file}`,
          };
        } catch (err) {
          console.error(`Erreur lors de la lecture du fichier ${file}:`, err);
          return null;
        }
      })
    );
    
    // Filtrer les valeurs null
    const validStats = fileStats.filter(stat => stat !== null);
    res.json(validStats.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()));
  } catch (error) {
    console.error('Erreur dans /api/files:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: error.message || 'Erreur lors de la lecture des fichiers' });
  }
});

// Stocker les processus en cours et leurs logs
const activeProcesses = new Map();

// Stocker les processus en attente de réponse
const pendingAnswers = new Map();

// Endpoint pour envoyer une réponse à un prompt interactif
app.post('/api/balance-calculator/answer/:processId', (req, res) => {
  const { processId } = req.params;
  const { answer } = req.body;
  
  const processData = activeProcesses.get(processId);
  if (processData && processData.proc && !processData.proc.stdin.destroyed) {
    try {
      // Pour les checkbox, on envoie les indices séparés par des espaces puis Enter
      // Pour les autres, on envoie directement la valeur
      processData.proc.stdin.write(answer + '\n');
      processData.addLog('info', `➡️ Réponse envoyée: ${answer || '(Enter)'}`);
      res.json({ message: 'Réponse envoyée' });
    } catch (error) {
      processData.addLog('error', `❌ Erreur lors de l'envoi de la réponse: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(404).json({ error: 'Processus non trouvé ou inactif' });
  }
});

// Endpoint SSE pour les logs en temps réel
app.get('/api/balance-calculator/logs/:processId', (req, res) => {
  const { processId } = req.params;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const processData = activeProcesses.get(processId);
  if (processData) {
    // Envoyer les logs existants
    processData.logs.forEach(log => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    });
    
    // Écouter les nouveaux logs
    const logListener = (log) => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    };
    processData.listeners.push(logListener);
    
    // Nettoyer à la déconnexion
    req.on('close', () => {
      const index = processData.listeners.indexOf(logListener);
      if (index > -1) {
        processData.listeners.splice(index, 1);
      }
    });
  } else {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Process not found' })}\n\n`);
    res.end();
  }
});

// Générer balances REG
// Endpoint générique pour lancer balance-calculator (toutes les tâches)
app.post('/api/balance-calculator/start', async (req, res) => {
  try {
    const params = req.body || {};
    const processId = `balance-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Créer un objet pour stocker les logs et les listeners
    const processData = {
      logs: [],
      listeners: [],
      proc: null,
    };
    activeProcesses.set(processId, processData);
    
    // Fonction pour ajouter un log
    const addLog = (type, message) => {
      const log = { type, message, timestamp: new Date().toISOString() };
      processData.logs.push(log);
      // Envoyer à tous les listeners
      processData.listeners.forEach(listener => listener(log));
      // Garder seulement les 1000 derniers logs
      if (processData.logs.length > 1000) {
        processData.logs.shift();
      }
    };
    
    // Envoyer la réponse avec l'ID du processus
    res.json({ 
      message: 'Balance-calculator lancé...', 
      processId 
    });
    
    // Charger les variables d'environnement de balance-calculator
    const balanceCalculatorEnvPath = path.join(balanceCalculatorPath, '.env');
    let balanceCalculatorEnv = {};
    
    if (existsSync(balanceCalculatorEnvPath)) {
      try {
        balanceCalculatorEnv = dotenv.parse(readFileSync(balanceCalculatorEnvPath, 'utf-8'));
        addLog('info', '📝 Variables d\'environnement chargées depuis .env');
      } catch (err) {
        addLog('stderr', `⚠️ Erreur lors du chargement du .env: ${err.message}`);
      }
    } else {
      addLog('stderr', '⚠️ Fichier .env non trouvé dans balance-calculator');
      addLog('info', '💡 Assurez-vous que le fichier .env existe avec THEGRAPH_API_KEY');
    }
    
    // Construire l'environnement pour le processus
    // Priorité: variables du serveur > variables du .env de balance-calculator > process.env
    const processEnv = {
      ...process.env,
      ...balanceCalculatorEnv, // Variables d'environnement de balance-calculator
      BALANCE_CALC_NETWORKS: JSON.stringify(params.networks || ['gnosis']),
      BALANCE_CALC_DEXS: JSON.stringify(params.dexs || {}),
      BALANCE_CALC_START_DATE: params.startDate || '',
      BALANCE_CALC_END_DATE: params.endDate || '',
      BALANCE_CALC_SNAPSHOT_TIME: params.snapshotTime || '00:00',
      BALANCE_CALC_TARGET_ADDRESS: params.targetAddress || 'all',
      BALANCE_CALC_USE_MOCK: params.useMock ? 'true' : 'false',
    };
    
    // Vérifier si THEGRAPH_API_KEY est défini
    if (!processEnv.THEGRAPH_API_KEY) {
      addLog('error', '❌ THEGRAPH_API_KEY n\'est pas défini');
      addLog('info', '💡 Créez un fichier .env dans balance-calculator/ avec: THEGRAPH_API_KEY=votre_cle');
      addLog('info', '💡 Ou définissez la variable d\'environnement dans le conteneur Docker');
      
      // Nettoyer et arrêter
      activeProcesses.delete(processId);
      return;
    }
    
    // Exécuter balance-calculator en arrière-plan avec les paramètres
    const proc = spawn('yarn', ['start'], {
      cwd: balanceCalculatorPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: processEnv,
    });
    
    processData.proc = proc;
    
    // Mode interactif : détecter les prompts et attendre les réponses de l'utilisateur
    let currentPrompt = null; // Prompt actuel en attente de réponse
    let optionsTimeout = null; // Timeout pour envoyer les options après collecte
    let optionsBuffer = []; // Buffer pour collecter les lignes après un prompt (pour extraire les options)
    let collectingOptions = false; // Flag pour savoir si on est en train de collecter des options
    
    addLog('info', '🚀 Démarrage de la génération des balances...');
    addLog('info', '💡 Mode interactif activé - Répondez aux questions ci-dessous');
    
    // Buffer pour accumuler les lignes (inquirer peut envoyer plusieurs lignes)
    let outputBuffer = '';
    
    // Fonction pour analyser le buffer et extraire les options
    const analyzeOptionsBuffer = () => {
      if (!currentPrompt || currentPrompt.optionsComplete) {
        console.log('⚠️ analyzeOptionsBuffer: prompt invalide ou déjà complété');
        return;
      }
      
      console.log('📦 Analyse du buffer avec', optionsBuffer.length, 'lignes');
      console.log('📦 Contenu du buffer:', optionsBuffer);
      
      // Analyser chaque ligne du buffer
      for (let i = 0; i < optionsBuffer.length; i++) {
        const bufferedLine = optionsBuffer[i];
        console.log(`  🔍 Analyse ligne ${i}:`, bufferedLine.substring(0, 60));
        
        // Nettoyer les codes ANSI mais garder le ❯
        const cleanLine = bufferedLine.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!cleanLine) {
          console.log(`    ⏭️ Ligne ${i} vide après nettoyage`);
          continue;
        }
        
        console.log(`    ✨ Ligne ${i} nettoyée:`, cleanLine);
        
        // Détecter les options avec indicateur ❯
        if (cleanLine.includes('❯') || cleanLine.match(/^[\s>]+[A-Z]/)) {
          let option = cleanLine.replace(/^[❯\s>]+/, '').replace(/\[.*?\]/g, '').trim();
          option = option.replace(/,$/, '').trim();
          console.log(`    🎯 Option extraite (avec ❯): "${option}"`);
          if (option && option.length > 2 && option.length < 100 && !currentPrompt.options.includes(option)) {
            currentPrompt.options.push(option);
            console.log('  ✅ Option ajoutée (avec ❯):', option);
          } else {
            console.log(`    ⚠️ Option rejetée: longueur=${option?.length}, déjà présente=${currentPrompt.options.includes(option)}`);
          }
        }
        // Détecter les options simples (commencent par une majuscule)
        else if (cleanLine.match(/^[A-Z][a-zA-Z0-9]+/) && 
                !cleanLine.includes('?') && 
                !cleanLine.includes('Use arrow') && 
                !cleanLine.includes('[') &&
                !cleanLine.match(/^\d+$/)) {
          let option = cleanLine.replace(/\[.*?\]/g, '').trim();
          option = option.replace(/,$/, '').trim();
          console.log(`    🎯 Option extraite (simple): "${option}"`);
          if (option && option.length > 2 && option.length < 100 && !currentPrompt.options.includes(option)) {
            currentPrompt.options.push(option);
            console.log('  ✅ Option ajoutée (simple):', option);
          } else {
            console.log(`    ⚠️ Option rejetée: longueur=${option?.length}, déjà présente=${currentPrompt.options.includes(option)}`);
          }
        } else {
          console.log(`    ⏭️ Ligne ${i} ne correspond à aucun pattern d'option`);
        }
      }
      
      // Si on a trouvé des options, envoyer le prompt
      // Pour le prompt "Quelle tâche", on accepte 3 ou 4 options (car GetBalancesREG peut ne pas apparaître)
      const isTaskPrompt = currentPrompt.question.includes('tâche') || currentPrompt.question.includes('task');
      const minOptions = isTaskPrompt ? 3 : 1; // Minimum 3 options pour le prompt "tâche"
      const expectedOptions = isTaskPrompt ? 4 : 1;
      
      console.log(`📊 Options trouvées: ${currentPrompt.options.length} (minimum: ${minOptions}, attendu: ${expectedOptions})`);
      
      // Si on a au moins le minimum d'options, on peut envoyer
      if (currentPrompt.options.length >= minOptions) {
        // On a assez d'options, envoyer le prompt
        currentPrompt.optionsComplete = true;
        collectingOptions = false;
        console.log('📤 Envoi du prompt avec', currentPrompt.options.length, 'options:', currentPrompt.options);
        addLog('prompt', JSON.stringify({
          type: currentPrompt.type,
          question: currentPrompt.question,
          options: currentPrompt.options
        }));
        optionsBuffer = [];
      } else if (currentPrompt.options.length > 0 && !collectingOptions) {
        // On ne collecte plus mais on a quelques options, envoyer quand même
        currentPrompt.optionsComplete = true;
        console.log('📤 Envoi du prompt avec', currentPrompt.options.length, 'options (collecte terminée):', currentPrompt.options);
        addLog('prompt', JSON.stringify({
          type: currentPrompt.type,
          question: currentPrompt.question,
          options: currentPrompt.options
        }));
        optionsBuffer = [];
      } else if (currentPrompt.options.length > 0) {
        // On a quelques options mais pas toutes, attendre encore un peu (mais limiter les tentatives)
        if (!currentPrompt.retryCount) {
          currentPrompt.retryCount = 0;
        }
        currentPrompt.retryCount++;
        
        console.log(`⏳ Seulement ${currentPrompt.options.length} option(s) trouvée(s), tentative ${currentPrompt.retryCount}/2...`);
        
        // Si on a déjà fait 2 tentatives et qu'on a au moins 2 options, envoyer le prompt
        if (currentPrompt.retryCount >= 2 && currentPrompt.options.length >= 2) {
          console.log('⏰ Limite de tentatives atteinte, envoi du prompt avec les options disponibles');
          currentPrompt.optionsComplete = true;
          collectingOptions = false;
          addLog('prompt', JSON.stringify({
            type: currentPrompt.type,
            question: currentPrompt.question,
            options: currentPrompt.options
          }));
          optionsBuffer = [];
        } else if (currentPrompt.retryCount >= 3) {
          // Même avec moins de 2 options, après 3 tentatives, envoyer quand même
          console.log('⏰ Trop de tentatives, envoi du prompt avec les options disponibles');
          currentPrompt.optionsComplete = true;
          collectingOptions = false;
          addLog('prompt', JSON.stringify({
            type: currentPrompt.type,
            question: currentPrompt.question,
            options: currentPrompt.options
          }));
          optionsBuffer = [];
        } else {
          // Réessayer après un délai
          if (optionsTimeout) {
            clearTimeout(optionsTimeout);
          }
          optionsTimeout = setTimeout(() => {
            if (currentPrompt && !currentPrompt.optionsComplete && collectingOptions) {
              console.log('⏰ Réessai après attente supplémentaire...');
              analyzeOptionsBuffer();
            }
          }, 2000);
        }
      } else {
        console.log('⚠️ Aucune option trouvée dans le buffer, réessai dans 500ms...');
        // Réessayer après un court délai (mais limiter aussi)
        if (!currentPrompt.retryCount) {
          currentPrompt.retryCount = 0;
        }
        currentPrompt.retryCount++;
        
        if (currentPrompt.retryCount >= 5) {
          console.log('❌ Trop de tentatives sans options, abandon');
          currentPrompt = null;
          collectingOptions = false;
          optionsBuffer = [];
        } else {
          if (optionsTimeout) {
            clearTimeout(optionsTimeout);
          }
          optionsTimeout = setTimeout(() => {
            if (currentPrompt && !currentPrompt.optionsComplete && collectingOptions) {
              analyzeOptionsBuffer();
            }
          }, 500);
        }
      }
    };

    proc.stdout.on('data', (data) => {
      outputBuffer += data.toString();
      const lines = outputBuffer.split('\n');
      
      // Garder la dernière ligne incomplète dans le buffer
      outputBuffer = lines.pop() || '';
      
      lines.forEach(line => {
        // IMPORTANT: Garder la ligne originale pour le buffer (avant nettoyage)
        const originalLine = line.trim();
        
        // Nettoyer les codes ANSI (couleurs, curseur, etc.)
        const cleaned = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\[[0-9;]*m/g, '');
        const trimmed = cleaned.trim();
        if (!trimmed) return;
        
        addLog('stdout', trimmed);
        console.log('Balance calculator output:', trimmed);
        
        // Détecter les prompts inquirer et les envoyer à l'interface
        // Les prompts inquirer peuvent avoir plusieurs formats:
        // - "? Question" (format standard)
        // - "Question ?" avec "Use arrow keys" (select/checkbox)
        // - Lignes contenant des mots-clés spécifiques
        
        // Détecter un prompt select/checkbox (avec "Use arrow keys")
        if (trimmed.includes('?') && trimmed.includes('Use arrow keys') && !currentPrompt) {
          // C'est un prompt select ou checkbox, on va attendre les options
          // Détecter si c'est un checkbox (permet sélection multiple) ou select (sélection unique)
          const isCheckbox = trimmed.includes('réseaux') || trimmed.includes('DEX') || trimmed.includes('checkbox');
          const isTaskPrompt = trimmed.includes('tâche') || trimmed.includes('task');
          
          // Tous les prompts sont maintenant interactifs, y compris "Quelle tâche"
          
          currentPrompt = {
            type: isCheckbox ? 'checkbox' : 'select',
            question: trimmed.replace(/\?.*$/, '').replace(/Use arrow keys.*$/, '').trim() || trimmed,
            options: [],
            detected: true,
            optionsComplete: false
          };
          // Commencer à collecter les lignes suivantes pour extraire les options
          collectingOptions = true;
          optionsBuffer = [];
          console.log('🔍 Prompt détecté, collecte des options...', currentPrompt.question);
          
          // Programmer un timeout pour analyser le buffer et envoyer le prompt
          if (optionsTimeout) {
            clearTimeout(optionsTimeout);
          }
          optionsTimeout = setTimeout(() => {
            if (currentPrompt && !currentPrompt.optionsComplete && collectingOptions) {
              // Analyser le buffer pour extraire les options
              analyzeOptionsBuffer();
            }
          }, 3000); // Attendre 3 secondes pour collecter toutes les options
        }
        // Si on est en train de collecter des options, ajouter la ligne au buffer
        // MAIS ne pas ajouter la ligne du prompt lui-même
        if (collectingOptions && currentPrompt && !currentPrompt.optionsComplete) {
          // Ignorer la ligne du prompt et les lignes de contrôle
          const isPromptLine = trimmed.includes('?') && trimmed.includes('Use arrow keys');
          if (!isPromptLine && !trimmed.includes('[?25') && trimmed.length > 0) {
            // Ajouter la ligne originale (avant nettoyage) pour garder le ❯
            optionsBuffer.push(originalLine);
            console.log('📝 Ligne ajoutée au buffer (originale):', originalLine.substring(0, 60));
            console.log('📝 Ligne ajoutée au buffer (nettoyée):', trimmed.substring(0, 60));
            // Réinitialiser le timeout à chaque nouvelle ligne
            if (optionsTimeout) {
              clearTimeout(optionsTimeout);
            }
            optionsTimeout = setTimeout(() => {
              console.log('⏰ Timeout déclenché, analyse du buffer avec', optionsBuffer.length, 'lignes...');
              if (currentPrompt && !currentPrompt.optionsComplete && collectingOptions) {
                analyzeOptionsBuffer();
              }
            }, 3000); // Attendre 3 secondes après la dernière ligne pour s'assurer d'avoir toutes les options
          } else if (isPromptLine) {
            console.log('⏭️ Ligne du prompt ignorée (ne pas ajouter au buffer)');
          }
        }
        
        // Détecter les options dans un prompt select/checkbox (ancienne méthode - gardée en fallback)
        if (currentPrompt && (currentPrompt.type === 'select' || currentPrompt.type === 'checkbox') && currentPrompt.detected && !currentPrompt.optionsComplete && !collectingOptions) {
          // Ignorer les lignes de contrôle ANSI et les lignes vides
          if (trimmed.includes('Use arrow keys') || trimmed.includes('[?25') || trimmed.length === 0) {
            // Ignorer
          } 
          // Détecter les lignes avec indicateur de sélection (❯ ou >)
          else if (trimmed.includes('❯') || trimmed.match(/^[\s>]+[A-Z]/)) {
            // Ligne avec indicateur de sélection, extraire l'option
            // Nettoyer : enlever ❯, espaces, >, et codes ANSI
            let option = trimmed.replace(/^[❯\s>]+/, '').replace(/\[.*?\]/g, '').trim();
            // Enlever aussi les virgules en fin de ligne (comme "GetAddressOwnRealToken,")
            option = option.replace(/,$/, '').trim();
            if (option && option.length > 0 && !option.startsWith('\x1b') && !currentPrompt.options.includes(option) && option.length < 100) {
              currentPrompt.options.push(option);
              console.log('✅ Option détectée (avec ❯):', option, 'Total:', currentPrompt.options.length);
              // Annuler le timeout précédent et en programmer un nouveau
              if (optionsTimeout) {
                clearTimeout(optionsTimeout);
              }
              optionsTimeout = setTimeout(() => {
                if (currentPrompt && !currentPrompt.optionsComplete && currentPrompt.options.length > 0) {
                  currentPrompt.optionsComplete = true;
                  console.log('Envoi du prompt avec options:', currentPrompt.options);
                  addLog('prompt', JSON.stringify({
                    type: currentPrompt.type,
                    question: currentPrompt.question,
                    options: currentPrompt.options
                  }));
                }
              }, 1000); // Attendre 1 seconde après la dernière option
            }
          } 
          // Détecter les options simples (lignes qui commencent par une majuscule, sans ? ni Use arrow)
          else if (trimmed.match(/^[A-Z][a-zA-Z0-9]+/) && !trimmed.includes('?') && !trimmed.includes('Use arrow') && !trimmed.includes('[') && !trimmed.match(/^\d+$/)) {
            // Option simple (sans indicateur) - doit commencer par une majuscule suivie de lettres/chiffres
            let cleanOption = trimmed.replace(/\[.*?\]/g, '').trim();
            // Enlever aussi les virgules en fin de ligne
            cleanOption = cleanOption.replace(/,$/, '').trim();
            // Vérifier que c'est bien une option valide (pas un message d'erreur ou autre)
            if (cleanOption && cleanOption.length > 2 && cleanOption.length < 100 && !currentPrompt.options.includes(cleanOption)) {
              currentPrompt.options.push(cleanOption);
              console.log('✅ Option détectée (simple):', cleanOption, 'Total:', currentPrompt.options.length);
              // Annuler le timeout précédent et en programmer un nouveau
              if (optionsTimeout) {
                clearTimeout(optionsTimeout);
              }
              optionsTimeout = setTimeout(() => {
                if (currentPrompt && !currentPrompt.optionsComplete && currentPrompt.options.length > 0) {
                  currentPrompt.optionsComplete = true;
                  console.log('Envoi du prompt avec options:', currentPrompt.options);
                  addLog('prompt', JSON.stringify({
                    type: currentPrompt.type,
                    question: currentPrompt.question,
                    options: currentPrompt.options
                  }));
                }
              }, 1000);
            }
          }
        }
        // Détecter un prompt confirm (Y/n)
        else if ((trimmed.includes('(Y/n)') || trimmed.includes('(y/N)') || 
                 (trimmed.includes('Voulez-vous') && trimmed.includes('?')) ||
                 (trimmed.includes('Souhaitez-vous') && trimmed.includes('?')) ||
                 (trimmed.includes('Utiliser des données de test mock') && trimmed.includes('?'))) && !currentPrompt) {
          currentPrompt = {
            type: 'confirm',
            question: trimmed,
            detected: true
          };
          addLog('prompt', JSON.stringify({
            type: 'confirm',
            question: currentPrompt.question
          }));
        }
        // Détecter un prompt input (date, texte, etc.)
        else if ((trimmed.includes('Entrez la date') || trimmed.includes('Enter the date') ||
                 trimmed.includes('Entrez le timestamp') || trimmed.includes('Enter the snapshot time') ||
                 (trimmed.match(/^\? .+/) && !trimmed.includes('Use arrow keys'))) && !currentPrompt) {
          currentPrompt = {
            type: 'input',
            question: trimmed.replace(/^\? /, '').trim() || trimmed,
            detected: true
          };
          addLog('prompt', JSON.stringify({
            type: 'input',
            question: currentPrompt.question
          }));
        }
        // Si un prompt a été complété (ligne avec "✔"), réinitialiser pour le prochain
        else if (trimmed.match(/^✔ .+\?/)) {
          // Si on était en train de collecter des options, analyser le buffer maintenant
          if (collectingOptions && currentPrompt && !currentPrompt.optionsComplete) {
            analyzeOptionsBuffer();
          }
          // Si on avait un prompt en cours qui n'a pas été envoyé, l'envoyer maintenant
          if (currentPrompt && !currentPrompt.optionsComplete && currentPrompt.options.length > 0) {
            if (optionsTimeout) {
              clearTimeout(optionsTimeout);
            }
            currentPrompt.optionsComplete = true;
            collectingOptions = false;
            addLog('prompt', JSON.stringify({
              type: currentPrompt.type,
              question: currentPrompt.question,
              options: currentPrompt.options
            }));
          }
          // Réinitialiser pour le prochain prompt
          currentPrompt = null;
          collectingOptions = false;
          optionsBuffer = [];
          if (optionsTimeout) {
            clearTimeout(optionsTimeout);
            optionsTimeout = null;
          }
          addLog('info', `✅ Prompt complété`);
        }
      });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n').filter(line => line.trim());
      lines.forEach(line => {
        addLog('stderr', line);
        console.error('Balance calculator error:', line);
      });
    });

    proc.on('close', (code) => {
      // Marquer le processus comme terminé
      if (processData) {
        processData.isActive = false;
      }
      // Nettoyer le timeout si le processus se termine
      if (optionsTimeout) {
        clearTimeout(optionsTimeout);
        optionsTimeout = null;
      }
      // Fermer stdin maintenant que le processus est terminé
      if (!proc.stdin.destroyed) {
        proc.stdin.end();
      }
      
      if (code === 0) {
        addLog('success', '✅ Génération terminée avec succès');
        console.log('✅ Balance generation completed successfully');
        // Recharger les fichiers après un court délai
        setTimeout(() => {
          // Les fichiers seront rechargés automatiquement par le frontend
        }, 2000);
      } else {
        addLog('error', `❌ Le processus s'est terminé avec le code ${code}`);
        console.error(`❌ Balance generation process exited with code ${code}`);
      }
      
      // Nettoyer après 5 minutes
      setTimeout(() => {
        activeProcesses.delete(processId);
      }, 5 * 60 * 1000);
    });

    // Ne pas fermer stdin immédiatement, on en a besoin pour envoyer les réponses
    // proc.stdin.end() sera appelé quand le processus se terminera
  } catch (error) {
    console.error('Error generating balances:', error);
  }
});

// Générer power voting
// Endpoint supprimé - maintenant tout passe par /api/balance-calculator/start
// L'utilisateur choisit interactivement quelle tâche exécuter

// Supprimer un fichier
app.delete('/api/files/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(outDatasPath, filename);
    
    // Sécurité: vérifier que le fichier est dans outDatas
    if (!filePath.startsWith(outDatasPath)) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }
    
    await fs.unlink(filePath);
    res.json({ message: 'Fichier supprimé' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rebuild balance-calculator
app.post('/api/rebuild', async (req, res) => {
  // Exécuter en arrière-plan pour éviter de bloquer la réponse
  (async () => {
    try {
      const repoUrl = 'https://github.com/RealToken-Community/balance-calculator.git';
      const branch = 'yohann-test-pool-v3-modeles';
      
      // Configurer Git pour accepter le répertoire (nécessaire dans Docker)
      await execAsync(`git config --global --add safe.directory ${projectRoot}`, { timeout: 5000 }).catch(() => {});
      await execAsync(`git config --global --add safe.directory ${balanceCalculatorPath}`, { timeout: 5000 }).catch(() => {});
      
      const exists = existsSync(balanceCalculatorPath);
      
      if (exists) {
        // Vérifier si c'est un dépôt git valide
        try {
          await execAsync(`cd ${balanceCalculatorPath} && git rev-parse --git-dir`, { timeout: 5000 });
          
          // Récupérer les branches distantes
          await execAsync(`cd ${balanceCalculatorPath} && git fetch origin`, { timeout: 30000 });
          
          // Vérifier si la branche existe
          const { stdout: branches } = await execAsync(`cd ${balanceCalculatorPath} && git branch -r`, { timeout: 5000 });
          const branchExists = branches.includes(`origin/${branch}`);
          
          if (branchExists) {
            // Mettre à jour
            await execAsync(`cd ${balanceCalculatorPath} && git checkout ${branch} && git pull origin ${branch}`, { timeout: 60000 });
          } else {
            console.warn(`⚠️ Branche ${branch} non trouvée, utilisation de la branche par défaut`);
            await execAsync(`cd ${balanceCalculatorPath} && git pull origin`, { timeout: 60000 });
          }
        } catch (gitError) {
          console.warn('⚠️ Erreur Git, tentative de clonage complet:', gitError.message);
          // Supprimer et recloner
          await execAsync(`rm -rf ${balanceCalculatorPath}`, { timeout: 10000 });
          await execAsync(`git clone -b ${branch} ${repoUrl} ${balanceCalculatorPath}`, { timeout: 120000 }).catch(async () => {
            // Si la branche n'existe pas, cloner la branche par défaut
            console.warn(`⚠️ Branche ${branch} non trouvée, clonage de la branche par défaut`);
            await execAsync(`git clone ${repoUrl} ${balanceCalculatorPath}`, { timeout: 120000 });
          });
        }
      } else {
        // Cloner
        try {
          await execAsync(`git clone -b ${branch} ${repoUrl} ${balanceCalculatorPath}`, { timeout: 120000 });
        } catch (cloneError) {
          // Si la branche n'existe pas, cloner la branche par défaut
          console.warn(`⚠️ Branche ${branch} non trouvée, clonage de la branche par défaut`);
          await execAsync(`git clone ${repoUrl} ${balanceCalculatorPath}`, { timeout: 120000 });
        }
        await execAsync(`git config --global --add safe.directory ${balanceCalculatorPath}`, { timeout: 5000 }).catch(() => {});
      }
      
      // Installer les dépendances
      await execAsync(`cd ${balanceCalculatorPath} && yarn install`, { timeout: 300000 });
      
      // Copier le .env du projet principal vers balance-calculator
      const sourceEnvPath = path.join(projectRoot, '.env');
      const targetEnvPath = path.join(balanceCalculatorPath, '.env');
      
      if (existsSync(sourceEnvPath)) {
        try {
          await fs.copyFile(sourceEnvPath, targetEnvPath);
          console.log('✅ Fichier .env copié vers balance-calculator');
        } catch (error) {
          console.warn(`⚠️ Erreur lors de la copie du .env: ${error.message}`);
        }
      } else {
        console.warn('⚠️ Fichier .env non trouvé dans le projet principal');
      }
      
      console.log('✅ Rebuild terminé avec succès');
    } catch (error) {
      console.error('❌ Rebuild error:', error);
    }
  })();
  
  // Envoyer la réponse immédiatement
  res.json({ message: 'Rebuild en cours...' });
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Gestion des erreurs non capturées
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Gestion des erreurs du serveur
app.on('error', (err) => {
  console.error('❌ Server error:', err);
});

try {
  app.listen(PORT, HOST, () => {
    console.log(`✅ Backend server running on http://${HOST}:${PORT}`);
    console.log(`📁 Serving files from: ${outDatasPath}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use`);
    } else {
      console.error('❌ Server error:', err);
    }
    process.exit(1);
  });
} catch (err) {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
}

