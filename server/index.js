import express from 'express';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { existsSync, readFileSync, readdirSync } from 'fs';
import dotenv from 'dotenv';
import multer from 'multer';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const workspacesDir = path.join(projectRoot, 'workspaces');
const WORKSPACE_INACTIVITY_DAYS = 14;

// Session-scoped paths: one workspace per browser/session (UUID in X-Session-Id)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidSessionId(id) {
  return typeof id === 'string' && UUID_REGEX.test(id.trim());
}
function getWorkspacePath(sessionId) {
  return path.join(workspacesDir, sessionId);
}
function getBalanceCalculatorPath(sessionId) {
  return path.join(getWorkspacePath(sessionId), 'balance-calculator');
}
function getOutDatasPath(sessionId) {
  return path.join(getBalanceCalculatorPath(sessionId), 'outDatas');
}
async function touchSessionUsed(sessionId) {
  const touchPath = path.join(getWorkspacePath(sessionId), '.lastUsed');
  await fs.writeFile(touchPath, String(Date.now()), 'utf-8').catch(() => {});
}
async function cleanupInactiveWorkspaces() {
  if (!existsSync(workspacesDir)) return;
  const cutoff = Date.now() - WORKSPACE_INACTIVITY_DAYS * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(workspacesDir, { withFileTypes: true }).catch(() => []);
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const sessionDir = path.join(workspacesDir, ent.name);
    const lastUsedPath = path.join(sessionDir, '.lastUsed');
    let mtime = 0;
    if (existsSync(lastUsedPath)) {
      const s = await fs.stat(lastUsedPath).catch(() => null);
      mtime = s ? s.mtimeMs : 0;
    } else {
      const s = await fs.stat(sessionDir).catch(() => null);
      mtime = s ? s.mtimeMs : 0;
    }
    if (mtime > 0 && mtime < cutoff) {
      await execAsync(`rm -rf ${sessionDir}`, { timeout: 30000 }).catch((e) =>
        console.warn(`Cleanup workspace ${ent.name}:`, e.message)
      );
      console.log(`🗑️ Workspace supprimé (inactivité > ${WORKSPACE_INACTIVITY_DAYS}j): ${ent.name}`);
    }
  }
}

fs.mkdir(workspacesDir, { recursive: true }).catch(console.error);

const app = express();
app.use(cors());
app.use(express.json());

// Middleware: require valid X-Session-Id for generation/upload (per-user isolation)
function ensureSession(req, res, next) {
  const sessionId = (req.headers['x-session-id'] || req.query.sessionId || '').trim();
  if (!isValidSessionId(sessionId)) {
    return res.status(400).json({
      error: 'Session invalide ou manquante',
      hint: 'Envoyez un UUID valide dans le header X-Session-Id (généré côté client, stocké en localStorage)',
    });
  }
  req.sessionId = sessionId;
  next();
}

// Configuration multer: destination = session's outDatas (ensureSession must run before)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = getOutDatasPath(req.sessionId);
    fs.mkdir(dest, { recursive: true })
      .then(() => cb(null, dest))
      .catch((err) => cb(err, dest));
  },
  filename: (req, file, cb) => {
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (safeName.includes('..') || safeName.startsWith('/') || safeName.startsWith('\\')) {
      return cb(new Error('Nom de fichier invalide'));
    }
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.csv', '.json'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return cb(new Error(`Type de fichier non autorisé. Utilisez uniquement CSV ou JSON.`));
    }
    const filename = path.basename(file.originalname);
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.length > 255) {
      return cb(new Error('Nom de fichier invalide'));
    }
    cb(null, true);
  },
});

// Fichiers générés: /generated/:sessionId/:filename (isolation par session)
app.get('/generated/:sessionId/:filename', (req, res, next) => {
  const { sessionId, filename } = req.params;
  if (!isValidSessionId(sessionId)) {
    return res.status(400).json({ error: 'Session invalide' });
  }
  let decodedFilename = filename;
  try {
    decodedFilename = decodeURIComponent(filename);
  } catch (_) {}
  const baseName = path.basename(decodedFilename);
  if (!baseName || baseName.includes('..') || baseName.includes('/') || baseName.includes('\\')) {
    return res.status(400).json({ error: 'Nom de fichier invalide' });
  }
  const filePath = path.join(getOutDatasPath(sessionId), baseName);
  const resolved = path.resolve(filePath);
  const resolvedOut = path.resolve(getOutDatasPath(sessionId));
  if (!resolved.startsWith(resolvedOut) || !existsSync(filePath)) {
    return res.status(404).json({ error: 'Fichier non trouvé' });
  }
  const safeForHeader = baseName.replace(/"/g, "'");
  res.setHeader('Content-Disposition', `attachment; filename="${safeForHeader}"`);
  res.sendFile(filePath);
});

// Lister les fichiers générés (par session)
app.get('/api/files', ensureSession, async (req, res) => {
  try {
    const outDatasPath = getOutDatasPath(req.sessionId);
    await touchSessionUsed(req.sessionId);
    const balanceCalculatorPath = getBalanceCalculatorPath(req.sessionId);
    if (!existsSync(balanceCalculatorPath)) {
      return res.json([]);
    }
    await fs.mkdir(outDatasPath, { recursive: true }).catch(() => {});
    if (!existsSync(outDatasPath)) {
      return res.status(500).json({ error: 'Impossible de créer le dossier outDatas' });
    }
    let files = await fs.readdir(outDatasPath).catch(() => []);
    const validFiles = files.filter((file) => {
      const filePath = path.join(outDatasPath, file);
      return existsSync(filePath) && !file.startsWith('.');
    });
    const fileStats = await Promise.all(
      validFiles.map(async (file) => {
        try {
          const filePath = path.join(outDatasPath, file);
          const stats = await fs.stat(filePath);
          if (stats.isDirectory()) return null;
          return {
            name: file,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            type: path.extname(file).slice(1) || 'unknown',
            url: `/generated/${req.sessionId}/${file}`,
          };
        } catch (err) {
          return null;
        }
      })
    );
    const validStats = fileStats.filter((s) => s !== null);
    res.json(validStats.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()));
  } catch (error) {
    console.error('Erreur dans /api/files:', error);
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
  if (!processData) {
    return res.status(404).json({ error: 'Processus non trouvé' });
  }
  
  if (!processData.proc) {
    return res.status(404).json({ error: 'Processus non initialisé' });
  }
  
  if (processData.proc.stdin.destroyed) {
    return res.status(404).json({ error: 'Processus terminé' });
  }
  
  try {
    // Nettoyer la réponse pour détecter les caractères spéciaux
    // Retirer les caractères de contrôle (\r, \n) pour vérifier le contenu réel
    const cleanAnswer = answer.replace(/\r/g, '').replace(/\n/g, '');
    
    // Si la réponse contient des codes ANSI (flèches), on les envoie directement sans \n
    if (answer.startsWith('\x1b[') || answer === '\x1b[A' || answer === '\x1b[B' || answer === '\x1b[C' || answer === '\x1b[D') {
      // C'est une touche spéciale (flèche), on l'envoie telle quelle
      processData.proc.stdin.write(answer);
    } else if (answer === '\n' || answer === '\r' || answer === '\r\n' || answer === '\n\r') {
      // C'est juste Enter, on l'envoie tel quel (validation)
      processData.proc.stdin.write('\n');
    } else if (cleanAnswer === ' ' || (cleanAnswer.length === 1 && cleanAnswer.charCodeAt(0) === 32)) {
      // C'est juste un espace (pour cocher/décocher dans les checkboxes), on l'envoie sans \n
      // L'espace doit permettre de cocher/décocher sans valider
      // Envoyer juste l'espace, sans aucun caractère de fin de ligne
      processData.proc.stdin.write(' ');
    } else {
      // C'est une réponse normale (texte), on ajoute \n pour Enter
      processData.proc.stdin.write(answer + '\n');
    }
    
    // Ne pas logger les réponses pour éviter la duplication
    // Les logs sont déjà affichés dans le terminal
    
    res.json({ message: 'Réponse envoyée' });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la réponse:', error);
    if (processData.addLog) {
      processData.addLog('error', `❌ Erreur lors de l'envoi de la réponse: ${error.message}`);
    }
    res.status(500).json({ error: error.message });
  }
});

// Endpoint SSE pour les logs en temps réel
app.get('/api/balance-calculator/logs/:processId', (req, res) => {
  const { processId } = req.params;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders(); // Envoyer les headers immédiatement pour que le proxy sache que c'est du SSE
  
  const processData = activeProcesses.get(processId);
  if (processData) {
    // Envoyer les logs existants
    processData.logs.forEach(log => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
      if (res.flush) res.flush();
    });
    
    // Écouter les nouveaux logs
    const logListener = (log) => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
      if (res.flush) res.flush();
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
    if (res.flush) res.flush();
    res.end();
  }
});

// Fonction pour obtenir toutes les tâches disponibles depuis balance-calculator (path = getBalanceCalculatorPath(sessionId))
const getAvailableTasks = (balanceCalculatorPath) => {
  if (!balanceCalculatorPath) return [];
  try {
    const tasksDir = path.join(balanceCalculatorPath, 'src', 'tasks');
    if (!existsSync(tasksDir)) return [];
    const taskFiles = readdirSync(tasksDir);
    return taskFiles
      .filter((file) => file.endsWith('.ts') || file.endsWith('.js'))
      .map((file) => path.basename(file, path.extname(file)))
      .filter((taskName) => taskName !== 'index');
  } catch (error) {
    return [];
  }
};

// Générer balances REG (par session)
app.post('/api/balance-calculator/start', ensureSession, async (req, res) => {
  try {
    await touchSessionUsed(req.sessionId);
    const balanceCalculatorPath = getBalanceCalculatorPath(req.sessionId);
    const params = req.body || {};
    const processId = `balance-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const processData = {
      logs: [],
      listeners: [],
      proc: null,
    };
    activeProcesses.set(processId, processData);
    const addLog = (type, message) => {
      const log = { type, message, timestamp: new Date().toISOString() };
      processData.logs.push(log);
      processData.listeners.forEach((listener) => listener(log));
      if (processData.logs.length > 1000) processData.logs.shift();
    };
    let taskOptionsDisplayed = false;
    res.json({ message: 'Balance-calculator lancé...', processId });
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
      // Laisser le processus dans activeProcesses pour que le client puisse lire les logs
      // Le client connectera l'EventSource après avoir reçu le processId
      setTimeout(() => activeProcesses.delete(processId), 5 * 60 * 1000);
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
    
    // Mode interactif simplifié : juste envoyer tous les logs en temps réel
    // L'utilisateur tape directement dans le terminal, pas besoin de détecter les prompts
    // On supprime toute la logique de détection de prompts - c'est beaucoup plus simple !
    
    addLog('info', '🚀 Démarrage de la génération des balances...');
    addLog('info', '💡 Mode interactif activé - Utilisez le terminal ci-dessous');
    
    // Variables pour la gestion des prompts interactifs
    let currentPrompt = null;
    let collectingOptions = false;
    let optionsBuffer = [];
    let optionsTimeout = null;
    
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

    // En mode non-PTY, inquirer réimprime le prompt entier à chaque touche fléchée.
    // On détecte les "rafraîchissements de prompt" et on injecte des codes ANSI cursor-up
    // pour effacer les lignes précédentes avant d'écrire le nouveau prompt.
    let prevPromptLineCount = 0;
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '');
    const countNonEmptyLines = (text) => stripAnsi(text).split('\n').filter((l) => l.trim().length > 0).length;
    const isPromptRefresh = (text) => {
      const clean = stripAnsi(text);
      return clean.includes('? ') && (clean.includes('❯') || clean.includes('(Use arrow keys)'));
    };

    proc.stdout.on('data', (data) => {
      const rawData = data.toString();
      let outputData = rawData;

      if (isPromptRefresh(rawData)) {
        if (prevPromptLineCount > 0) {
          // Remonter de N lignes et effacer jusqu'à la fin de l'écran (comme un vrai PTY)
          outputData = `\x1b[${prevPromptLineCount}A\x1b[J${rawData}`;
        }
        prevPromptLineCount = countNonEmptyLines(rawData);
      } else {
        prevPromptLineCount = 0;
      }

      addLog('stdout', outputData);
      console.log('Balance calculator output (raw):', rawData.substring(0, 200));
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

// Upload de fichiers vers outDatas (par session)
app.post('/api/files/upload', ensureSession, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }
    const outDatasPath = getOutDatasPath(req.sessionId);
    const balanceCalculatorPath = getBalanceCalculatorPath(req.sessionId);
    if (!existsSync(balanceCalculatorPath)) {
      return res.status(400).json({ error: 'balance-calculator n\'est pas encore cloné pour cette session' });
    }
    await touchSessionUsed(req.sessionId);
    const uploadedFiles = [];
    const errors = [];
    for (const file of req.files) {
      try {
        const filePath = path.join(outDatasPath, file.filename);
        const resolvedPath = path.resolve(filePath);
        const resolvedOutDatas = path.resolve(outDatasPath);
        if (!resolvedPath.startsWith(resolvedOutDatas) || !existsSync(filePath)) {
          errors.push(`Fichier ${file.filename}: accès non autorisé ou non sauvegardé`);
          continue;
        }
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) {
          await fs.unlink(filePath).catch(() => {});
          continue;
        }
        uploadedFiles.push({
          name: file.filename,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
        });
      } catch (fileError) {
        errors.push(`Erreur pour ${file.filename}: ${fileError.message}`);
      }
    }
    if (uploadedFiles.length === 0) {
      return res.status(500).json({
        error: 'Aucun fichier n\'a pu être uploadé',
        details: errors,
      });
    }
    res.json({
      message: `${uploadedFiles.length} fichier(s) uploadé(s) avec succès`,
      files: uploadedFiles,
      warnings: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Erreur lors de l\'upload de fichiers:', error);
    res.status(500).json({ error: error.message || 'Erreur lors de l\'upload' });
  }
});

// Helper: supprimer un fichier dans le outDatas de la session
async function deleteFileInSession(req, res, filename) {
  const outDatasPath = getOutDatasPath(req.sessionId);
  await touchSessionUsed(req.sessionId);
  const safeName = path.basename(String(filename || '').trim());
  if (!safeName) {
    return res.status(400).json({ error: 'Nom de fichier invalide' });
  }
  const filePath = path.join(outDatasPath, safeName);
  const resolvedPath = path.resolve(filePath);
  const resolvedOutDatas = path.resolve(outDatasPath);
  if (!resolvedPath.startsWith(resolvedOutDatas)) {
    return res.status(403).json({ error: 'Accès non autorisé' });
  }
  const fileExists = existsSync(filePath);
  console.log('[deleteFile] sessionId=', req.sessionId, 'filename=', safeName, 'path=', filePath, 'exists=', fileExists);
  if (!fileExists) {
    return res.status(404).json({ error: 'Fichier non trouvé' });
  }
  await fs.unlink(filePath);
  return res.json({ message: 'Fichier supprimé' });
}

// Supprimer un fichier (par session) – DELETE avec filename dans l’URL
app.delete('/api/files/:filename', ensureSession, async (req, res) => {
  try {
    await deleteFileInSession(req, res, req.params.filename);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }
    console.error('[DELETE /api/files] error', error);
    res.status(500).json({ error: error.message });
  }
});

// Supprimer un fichier (par session) – POST avec filename dans le body (évite soucis d’URL)
app.post('/api/files/delete', ensureSession, async (req, res) => {
  try {
    const filename = req.body?.filename;
    await deleteFileInSession(req, res, filename);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }
    console.error('[POST /api/files/delete] error', error);
    res.status(500).json({ error: error.message });
  }
});

// Rebuild balance-calculator
// Endpoint pour récupérer les branches d'un repository
app.post('/api/repositories/branches', async (req, res) => {
  try {
    const { repositoryUrl } = req.body || {};
    
    if (!repositoryUrl) {
      return res.status(400).json({ error: 'repositoryUrl est requis' });
    }
    
    console.log(`📋 Récupération des branches pour: ${repositoryUrl}`);
    
    // Utiliser git ls-remote pour récupérer les branches sans cloner
    // Échapper l'URL pour éviter les problèmes avec les caractères spéciaux
    const { stdout, stderr } = await execAsync(`git ls-remote --heads "${repositoryUrl}"`, { timeout: 30000 });
    
    if (stderr && !stdout) {
      console.error('Erreur git ls-remote:', stderr);
      throw new Error(`Erreur lors de la récupération des branches: ${stderr}`);
    }
    
    // Parser la sortie pour extraire les noms de branches
    const branches = stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        // Format: <hash>	refs/heads/<branch-name>
        const match = line.match(/refs\/heads\/(.+)$/);
        return match ? match[1] : null;
      })
      .filter(branch => branch !== null)
      .sort(); // Trier les branches par ordre alphabétique
    
    console.log(`✅ ${branches.length} branches trouvées:`, branches);
    
    res.json({ branches });
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des branches:', error);
    // En cas d'erreur, retourner un tableau vide avec un message d'erreur
    res.status(500).json({ 
      error: error.message || 'Erreur lors de la récupération des branches',
      branches: [] 
    });
  }
});

app.post('/api/rebuild', ensureSession, async (req, res) => {
  try {
    await touchSessionUsed(req.sessionId);
    const balanceCalculatorPath = getBalanceCalculatorPath(req.sessionId);
    const workspacePath = getWorkspacePath(req.sessionId);
    const { repositoryUrl, branch: requestedBranch } = req.body || {};
    const repoUrl = repositoryUrl || 'https://github.com/RealToken-Community/balance-calculator.git';
    const branch = requestedBranch || 'yohann-test-pool-v3-modeles';
    const processId = `rebuild-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const processData = { logs: [], listeners: [] };
    activeProcesses.set(processId, processData);
    const addLog = (type, message) => {
      let formattedMessage = message;
      if (!formattedMessage.endsWith('\n') && !formattedMessage.endsWith('\r\n')) {
        formattedMessage += '\r\n';
      }
      const log = { type, message: formattedMessage, timestamp: new Date().toISOString() };
      processData.logs.push(log);
      processData.listeners.forEach((listener) => listener(log));
      if (processData.logs.length > 1000) {
        processData.logs.shift();
      }
    };
    
    // Envoyer la réponse avec l'ID du processus
    res.json({ 
      message: 'Rebuild en cours...', 
      processId 
    });
    
    // Exécuter le rebuild en arrière-plan
    (async () => {
      try {
        addLog('info', '🔄 Démarrage du rebuild de balance-calculator...');
        addLog('info', `📦 Repository: ${repoUrl}`);
        await fs.mkdir(workspacePath, { recursive: true });
        await execAsync(`git config --global --add safe.directory ${projectRoot}`, { timeout: 5000 }).catch(() => {});
        await execAsync(`git config --global --add safe.directory ${balanceCalculatorPath}`, { timeout: 5000 }).catch(() => {});
        const exists = existsSync(balanceCalculatorPath);
        if (exists) {
          addLog('info', '🗑️ Suppression du projet existant...');
          await execAsync(`rm -rf ${balanceCalculatorPath}`, { timeout: 30000 });
          addLog('info', '✅ Projet existant supprimé');
        }
        addLog('info', '📥 Clonage du dépôt...');
        try {
          await execAsync(`git clone -b ${branch} ${repoUrl} ${balanceCalculatorPath}`, { timeout: 120000 });
          addLog('info', `✅ Dépôt cloné avec succès (branche: ${branch})`);
        } catch (cloneError) {
          addLog('info', `⚠️ Branche ${branch} non trouvée, clonage de la branche par défaut`);
          await execAsync(`git clone ${repoUrl} ${balanceCalculatorPath}`, { timeout: 120000 });
          addLog('info', '✅ Dépôt cloné avec succès (branche par défaut)');
        }
        
        // Configurer Git pour le nouveau dépôt
        await execAsync(`git config --global --add safe.directory ${balanceCalculatorPath}`, { timeout: 5000 }).catch(() => {});
        
        // S'assurer que les fichiers appartiennent à l'utilisateur actuel (pour éviter les problèmes de permissions)
        // Si le serveur tourne en root (Docker), changer le propriétaire vers l'utilisateur du répertoire parent
        try {
          // Obtenir l'utilisateur du répertoire parent
          const parentOwnerResult = await execAsync(`stat -c '%U:%G' ${projectRoot}`, { timeout: 5000 });
          const parentOwner = parentOwnerResult.stdout.trim();
          
          // Changer le propriétaire de balance-calculator vers le même utilisateur
          await execAsync(`chown -R ${parentOwner} ${balanceCalculatorPath}`, { timeout: 10000 });
          addLog('info', `✅ Permissions corrigées (propriétaire: ${parentOwner})`);
        } catch (chownError) {
          // Si on n'a pas les permissions ou si la commande échoue, essayer avec l'utilisateur actuel
          try {
            const currentUser = process.env.USER || process.env.USERNAME || 'ubuntu';
            await execAsync(`chown -R ${currentUser}:${currentUser} ${balanceCalculatorPath}`, { timeout: 10000 });
            addLog('info', `✅ Permissions corrigées (propriétaire: ${currentUser})`);
          } catch (fallbackError) {
            // Dernière tentative : utiliser sudo si disponible
            try {
              const currentUser = process.env.USER || process.env.USERNAME || 'ubuntu';
              await execAsync(`sudo chown -R ${currentUser}:${currentUser} ${balanceCalculatorPath}`, { timeout: 10000 });
              addLog('info', `✅ Permissions corrigées avec sudo (propriétaire: ${currentUser})`);
            } catch (sudoError) {
              // Ignorer les erreurs de chown (peut ne pas avoir les permissions)
              addLog('warning', '⚠️ Impossible de corriger les permissions automatiquement (non bloquant)');
              addLog('warning', '💡 Vous devrez peut-être corriger manuellement avec: sudo chown -R $USER:$USER balance-calculator');
            }
          }
        }
        
        // Installer les dépendances
        addLog('info', '📦 Installation des dépendances...');
        await execAsync(`cd ${balanceCalculatorPath} && yarn install`, { timeout: 300000 });
        
        // Copier les variables d'environnement depuis .env.local du projet principal vers balance-calculator/.env
        const sourceEnvLocalPath = path.join(projectRoot, '.env.local');
        const targetEnvPath = path.join(balanceCalculatorPath, '.env');
        
        // Variables requises à copier
        const requiredEnvVars = [
          'THEGRAPH_API_KEY',
          'API_KEY_GNOSISSCAN',
          'API_KEY_ETHERSCAN',
          'API_KEY_POLYGONSCAN',
          'API_KEY_MORALIS'
        ];
        
        if (existsSync(sourceEnvLocalPath)) {
          try {
            // Lire le .env.local du projet principal
            const envLocalContent = readFileSync(sourceEnvLocalPath, 'utf-8');
            const envLocalLines = envLocalContent.split('\n');
            
            // Extraire uniquement les variables requises
            const extractedVars = new Map();
            envLocalLines.forEach(line => {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#')) {
                const match = trimmed.match(/^([^=]+)=(.*)$/);
                if (match) {
                  const key = match[1].trim();
                  const value = match[2].trim();
                  if (requiredEnvVars.includes(key)) {
                    extractedVars.set(key, value);
                  }
                }
              }
            });
            
            // Si on a trouvé au moins une variable requise, créer/mettre à jour le .env
            if (extractedVars.size > 0) {
              // Lire le .env existant de balance-calculator s'il existe
              let existingEnvContent = '';
              const envExists = existsSync(targetEnvPath);
              if (envExists) {
                existingEnvContent = readFileSync(targetEnvPath, 'utf-8');
              }
              
              // Parser le contenu existant
              const existingLines = existingEnvContent ? existingEnvContent.split('\n') : [];
              const updatedLines = [];
              const processedKeys = new Set();
              
              // Mettre à jour les variables existantes
              existingLines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                  const match = trimmed.match(/^([^=]+)=(.*)$/);
                  if (match) {
                    const key = match[1].trim();
                    if (extractedVars.has(key)) {
                      // Remplacer par la valeur de .env.local
                      updatedLines.push(`${key}=${extractedVars.get(key)}`);
                      processedKeys.add(key);
                    } else {
                      // Garder les autres variables telles quelles
                      updatedLines.push(line);
                    }
                  } else {
                    // Garder les lignes non-variables (commentaires, lignes vides, etc.)
                    updatedLines.push(line);
                  }
                } else {
                  // Garder les commentaires et lignes vides
                  updatedLines.push(line);
                }
              });
              
              // Ajouter les variables manquantes à la fin
              extractedVars.forEach((value, key) => {
                if (!processedKeys.has(key)) {
                  // Ajouter une ligne vide avant si ce n'est pas la première variable
                  if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1].trim() !== '') {
                    updatedLines.push('');
                  }
                  updatedLines.push(`${key}=${value}`);
                }
              });
              
              // Écrire le fichier .env
              await fs.writeFile(targetEnvPath, updatedLines.join('\n'), 'utf-8');
              addLog('info', `✅ ${extractedVars.size} variable(s) d'environnement copiée(s) depuis .env.local vers balance-calculator/.env`);
            } else {
              addLog('warning', '⚠️ Aucune variable requise trouvée dans .env.local');
            }
          } catch (error) {
            addLog('error', `⚠️ Erreur lors de la copie des variables depuis .env.local: ${error.message}`);
          }
        } else {
          addLog('info', 'ℹ️ Fichier .env.local non trouvé dans le projet principal');
        }
        
        addLog('info', '✅ Rebuild terminé avec succès');
        // Envoyer un message spécial pour indiquer que le rebuild est terminé
        addLog('info', '🔄 Rebuild terminé - Les infos Git seront mises à jour automatiquement');
      } catch (error) {
        addLog('error', `❌ Erreur lors du rebuild: ${error.message}`);
      } finally {
        // Nettoyer après un délai plus long pour laisser le temps à tous les logs d'être envoyés
        // Ne pas supprimer immédiatement pour éviter de couper les logs
        setTimeout(() => {
          activeProcesses.delete(processId);
        }, 300000); // Garder les logs pendant 5 minutes pour permettre la consultation complète
      }
    })();
  } catch (error) {
    console.error('❌ Rebuild error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour lire le fichier optionsModifiers.ts (par session)
app.get('/api/balance-calculator/config/options-modifiers', ensureSession, async (req, res) => {
  try {
    await touchSessionUsed(req.sessionId);
    const balanceCalculatorPath = getBalanceCalculatorPath(req.sessionId);
    if (!existsSync(balanceCalculatorPath)) {
      return res.status(404).json({
        error: 'balance-calculator n\'est pas encore cloné',
        content: '',
      });
    }
    let optionsModifiersPath = path.join(balanceCalculatorPath, 'src', 'configs', 'optionsModifiers.ts');
    if (!existsSync(optionsModifiersPath)) {
      // Essayer avec config au lieu de configs
      optionsModifiersPath = path.join(balanceCalculatorPath, 'src', 'config', 'optionsModifiers.ts');
    }
    
    if (!existsSync(optionsModifiersPath)) {
      console.log(`Fichier non trouvé: ${optionsModifiersPath}`);
      // Retourner un contenu vide au lieu d'une erreur 404 pour permettre la création
      return res.json({ 
        error: 'Fichier optionsModifiers.ts non trouvé. Vous pouvez le créer en sauvegardant.',
        content: '' 
      });
    }
    
    const content = readFileSync(optionsModifiersPath, 'utf-8');
    res.json({ content });
  } catch (error) {
    console.error('Erreur lors de la lecture de optionsModifiers.ts:', error);
    res.status(500).json({ error: error.message, content: '' });
  }
});

// Endpoint pour sauvegarder le fichier optionsModifiers.ts (par session)
app.post('/api/balance-calculator/config/options-modifiers', ensureSession, async (req, res) => {
  try {
    await touchSessionUsed(req.sessionId);
    const balanceCalculatorPath = getBalanceCalculatorPath(req.sessionId);
    const { content } = req.body || {};
    if (!content) {
      return res.status(400).json({ error: 'Le contenu est requis' });
    }
    if (!existsSync(balanceCalculatorPath)) {
      return res.status(404).json({ error: 'balance-calculator n\'est pas encore cloné' });
    }
    const configsDir = path.join(balanceCalculatorPath, 'src', 'configs');
    const configDir = path.join(balanceCalculatorPath, 'src', 'config');
    const targetDir = existsSync(configsDir) ? configsDir : (existsSync(configDir) ? configDir : configsDir);
    
    // Créer le dossier s'il n'existe pas
    if (!existsSync(targetDir)) {
      await fs.mkdir(targetDir, { recursive: true });
    }
    
    const optionsModifiersPath = path.join(targetDir, 'optionsModifiers.ts');
    
    // Sauvegarder le fichier
    await fs.writeFile(optionsModifiersPath, content, 'utf-8');
    
    res.json({ message: 'Configuration sauvegardée avec succès' });
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de optionsModifiers.ts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour lire le fichier .env de balance-calculator (par session)
app.get('/api/balance-calculator/config/env', ensureSession, async (req, res) => {
  try {
    await touchSessionUsed(req.sessionId);
    const balanceCalculatorPath = getBalanceCalculatorPath(req.sessionId);
    if (!existsSync(balanceCalculatorPath)) {
      return res.status(404).json({
        error: 'balance-calculator n\'est pas encore cloné',
        content: '',
      });
    }
    const targetEnvPath = path.join(balanceCalculatorPath, '.env');
    
    // Si .env existe, le lire directement (ne pas le remplacer)
    if (existsSync(targetEnvPath)) {
      const content = readFileSync(targetEnvPath, 'utf-8');
      return res.json({ content });
    }
    
    // Si .env n'existe pas, chercher .env.local ou .env.example pour l'initialiser
    let envPath = path.join(balanceCalculatorPath, '.env.local');
    if (!existsSync(envPath)) {
      envPath = path.join(balanceCalculatorPath, '.env.example');
    }
    
    // Si on a trouvé .env.local ou .env.example, copier vers .env (seulement la première fois)
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      await fs.writeFile(targetEnvPath, content, 'utf-8');
      console.log(`Fichier ${path.basename(envPath)} copié vers .env (initialisation)`);
      return res.json({ content });
    }
    
    // Aucun fichier trouvé
    console.log(`Aucun fichier .env trouvé dans ${balanceCalculatorPath}`);
    return res.json({ 
      error: 'Aucun fichier .env trouvé. Vous pouvez le créer en sauvegardant.',
      content: '' 
    });
  } catch (error) {
    console.error('Erreur lors de la lecture du fichier .env:', error);
    res.status(500).json({ error: error.message, content: '' });
  }
});

// Endpoint pour sauvegarder le fichier .env de balance-calculator (par session)
app.post('/api/balance-calculator/config/env', ensureSession, async (req, res) => {
  try {
    await touchSessionUsed(req.sessionId);
    const balanceCalculatorPath = getBalanceCalculatorPath(req.sessionId);
    const { content } = req.body || {};
    if (!content) {
      return res.status(400).json({ error: 'Le contenu est requis' });
    }
    if (!existsSync(balanceCalculatorPath)) {
      return res.status(404).json({ error: 'balance-calculator n\'est pas encore cloné' });
    }
    const envPath = path.join(balanceCalculatorPath, '.env');
    await fs.writeFile(envPath, content, 'utf-8');
    
    res.json({ message: 'Variables d\'environnement sauvegardées avec succès' });
  } catch (error) {
    console.error('Erreur lors de la sauvegarde du fichier .env:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour vérifier si .env.local existe avec toutes les variables requises
app.get('/api/env-local/check', async (req, res) => {
  try {
    const envLocalPath = path.join(projectRoot, '.env.local');
    const requiredEnvVars = [
      'THEGRAPH_API_KEY',
      'API_KEY_GNOSISSCAN',
      'API_KEY_ETHERSCAN',
      'API_KEY_POLYGONSCAN',
      'API_KEY_MORALIS'
    ];
    
    // Vérifier si le fichier existe
    if (!existsSync(envLocalPath)) {
      return res.json({
        exists: false,
        hasAllRequiredVars: false,
        missingVars: requiredEnvVars,
        foundVars: []
      });
    }
    
    // Lire le fichier
    const content = readFileSync(envLocalPath, 'utf-8');
    const lines = content.split('\n');
    
    // Extraire les variables présentes
    const foundVars = [];
    const foundVarsMap = new Map();
    
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          if (requiredEnvVars.includes(key)) {
            foundVars.push(key);
            foundVarsMap.set(key, match[2].trim());
          }
        }
      }
    });
    
    // Vérifier si toutes les variables requises sont présentes et non vides
    const missingVars = requiredEnvVars.filter(key => {
      if (!foundVarsMap.has(key)) {
        return true;
      }
      const value = foundVarsMap.get(key);
      // Vérifier que la valeur n'est pas vide (après avoir retiré les guillemets)
      const cleanValue = value.replace(/^["']+|["']+$/g, '').trim();
      return !cleanValue;
    });
    
    const hasAllRequiredVars = missingVars.length === 0;
    
    res.json({
      exists: true,
      hasAllRequiredVars,
      missingVars,
      foundVars
    });
  } catch (error) {
    console.error('Erreur lors de la vérification de .env.local:', error);
    res.status(500).json({ 
      error: error.message,
      exists: false,
      hasAllRequiredVars: false
    });
  }
});

// Endpoint pour corriger les permissions de balance-calculator (par session)
app.post('/api/balance-calculator/fix-permissions', ensureSession, async (req, res) => {
  try {
    await touchSessionUsed(req.sessionId);
    const balanceCalculatorPath = getBalanceCalculatorPath(req.sessionId);
    if (!existsSync(balanceCalculatorPath)) {
      return res.status(404).json({ error: 'balance-calculator n\'existe pas encore' });
    }
    let parentOwner = 'ubuntu:ubuntu';
    try {
      const parentOwnerResult = await execAsync(`stat -c '%U:%G' ${projectRoot}`, { timeout: 5000 });
      parentOwner = parentOwnerResult.stdout.trim();
    } catch (error) {
      const currentUser = process.env.USER || process.env.USERNAME || 'ubuntu';
      parentOwner = `${currentUser}:${currentUser}`;
    }
    try {
      await execAsync(`chown -R ${parentOwner} ${balanceCalculatorPath}`, { timeout: 10000 });
      return res.json({ 
        message: 'Permissions corrigées avec succès',
        owner: parentOwner
      });
    } catch (chownError) {
      // Essayer avec sudo
      try {
        const currentUser = process.env.USER || process.env.USERNAME || 'ubuntu';
        await execAsync(`sudo chown -R ${currentUser}:${currentUser} ${balanceCalculatorPath}`, { timeout: 10000 });
        return res.json({ 
          message: 'Permissions corrigées avec succès (via sudo)',
          owner: `${currentUser}:${currentUser}`
        });
      } catch (sudoError) {
        return res.status(500).json({ 
          error: 'Impossible de corriger les permissions',
          details: sudoError.message
        });
      }
    }
  } catch (error) {
    console.error('Erreur lors de la correction des permissions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour récupérer les informations Git de balance-calculator (par session)
app.get('/api/balance-calculator/git-info', ensureSession, async (req, res) => {
  try {
    await touchSessionUsed(req.sessionId);
    const balanceCalculatorPath = getBalanceCalculatorPath(req.sessionId);
    if (!existsSync(balanceCalculatorPath)) {
      return res.json({
        branch: null,
        remote: null,
        exists: false,
        isGitRepo: false,
      });
    }
    let isGitRepo = false;
    try {
      await execAsync(`cd ${balanceCalculatorPath} && git rev-parse --git-dir`, { timeout: 5000 });
      isGitRepo = true;
    } catch (err) {
      // Ce n'est pas un dépôt Git valide
      return res.json({
        branch: null,
        remote: null,
        exists: true,
        isGitRepo: false,
      });
    }
    
    let branch = null;
    let remote = null;
    
    try {
      // Récupérer la branche actuelle
      const { stdout: branchOutput } = await execAsync(`cd ${balanceCalculatorPath} && git rev-parse --abbrev-ref HEAD`, { timeout: 5000 });
      branch = branchOutput.trim();
    } catch (err) {
      console.warn('Erreur lors de la récupération de la branche:', err.message);
    }
    
    try {
      // Récupérer l'URL du remote origin
      const { stdout: remoteOutput } = await execAsync(`cd ${balanceCalculatorPath} && git remote get-url origin`, { timeout: 5000 });
      remote = remoteOutput.trim();
    } catch (err) {
      console.warn('Erreur lors de la récupération du remote:', err.message);
    }
    
    res.json({
      branch,
      remote,
      exists: true,
      isGitRepo: true,
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des infos Git:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint SSE pour les logs du rebuild
app.get('/api/rebuild/logs/:processId', (req, res) => {
  const { processId } = req.params;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const processData = activeProcesses.get(processId);
  
  if (!processData) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Processus non trouvé' })}\n\n`);
    res.end();
    return;
  }
  
  // Envoyer les logs existants
  processData.logs.forEach(log => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });
  
  // Ajouter un listener pour les nouveaux logs
  const listener = (log) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  };
  
  processData.listeners.push(listener);
  
  // Nettoyer quand la connexion se ferme
  req.on('close', () => {
    const index = processData.listeners.indexOf(listener);
    if (index > -1) {
      processData.listeners.splice(index, 1);
    }
  });
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
  app.listen(PORT, HOST, async () => {
    console.log(`✅ Backend server running on http://${HOST}:${PORT}`);
    console.log(`📁 Workspaces (session-scoped): ${workspacesDir}`);
    await cleanupInactiveWorkspaces();
    setInterval(() => cleanupInactiveWorkspaces().catch((e) => console.warn('Cleanup:', e.message)), 24 * 60 * 60 * 1000);
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

