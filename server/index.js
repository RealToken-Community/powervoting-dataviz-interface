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
    await fs.mkdir(outDatasPath, { recursive: true });
    const files = await fs.readdir(outDatasPath);
    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(outDatasPath, file);
        const stats = await fs.stat(filePath);
        return {
          name: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          type: path.extname(file).slice(1),
          url: `/generated/${file}`,
        };
      })
    );
    res.json(fileStats.sort((a, b) => b.modified - a.modified));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stocker les processus en cours et leurs logs
const activeProcesses = new Map();

// Stocker les processus en attente de réponse
const pendingAnswers = new Map();

// Endpoint pour envoyer une réponse à un prompt
app.post('/api/generate/balances/answer/:processId', (req, res) => {
  const { processId } = req.params;
  const { answer } = req.body;
  
  const processData = activeProcesses.get(processId);
  if (processData && processData.proc) {
    // Envoyer la réponse au processus
    processData.proc.stdin.write(answer + '\n');
    res.json({ message: 'Réponse envoyée' });
  } else {
    res.status(404).json({ error: 'Process not found' });
  }
});

// Endpoint SSE pour les logs en temps réel
app.get('/api/generate/balances/logs/:processId', (req, res) => {
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
app.post('/api/generate/balances', async (req, res) => {
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
      message: 'Génération en cours...', 
      task: 'GetBalancesREG',
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
    
    // Ne plus envoyer de réponses automatiques - l'utilisateur interagira via l'interface
    addLog('info', '🚀 Démarrage de la génération des balances...');
    addLog('info', '💡 Répondez aux questions qui apparaîtront ci-dessous');

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n').filter(line => line.trim());
      
      lines.forEach(line => {
        addLog('stdout', line);
        console.log('Balance calculator output:', line);
        
        // Ne plus envoyer de réponses automatiques - l'utilisateur interagira via l'interface
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
      if (code === 0) {
        addLog('success', '✅ Génération terminée avec succès');
        console.log('✅ Balance generation completed successfully');
      } else {
        addLog('error', `❌ Le processus s'est terminé avec le code ${code}`);
        console.error(`❌ Balance generation process exited with code ${code}`);
      }
      
      // Nettoyer après 5 minutes
      setTimeout(() => {
        activeProcesses.delete(processId);
      }, 5 * 60 * 1000);
    });

    // Démarrer la séquence
    addLog('info', '🚀 Démarrage de la génération des balances...');
    setTimeout(() => responses[step++]?.(), 1000);
    
    proc.stdin.end();
  } catch (error) {
    console.error('Error generating balances:', error);
  }
});

// Générer power voting
app.post('/api/generate/power-voting', async (req, res) => {
  try {
    res.json({ message: 'Génération en cours...', task: 'CalculatePowerVotingREG' });
    
    const proc = spawn('yarn', ['start'], {
      cwd: balanceCalculatorPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    setTimeout(() => {
      proc.stdin.write('CalculatePowerVotingREG\n');
    }, 1000);

    proc.on('close', (code) => {
      console.log(`Power voting generation process exited with code ${code}`);
    });

    proc.stdin.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

