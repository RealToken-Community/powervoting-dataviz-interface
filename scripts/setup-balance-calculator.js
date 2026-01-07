import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const balanceCalculatorPath = path.join(projectRoot, 'balance-calculator');
const repoUrl = 'https://github.com/RealToken-Community/balance-calculator.git';
const branch = 'yohann-test-pool-v3-modeles';

async function copyEnvFile() {
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
    console.warn('💡 Créez un fichier .env à la racine du projet avec les clés API nécessaires');
  }
}

async function setupBalanceCalculator() {
  try {
    console.log('🔧 Configuration de balance-calculator...');
    
    const exists = await fs.access(balanceCalculatorPath).then(() => true).catch(() => false);
    
    if (exists) {
      console.log('📦 Mise à jour de balance-calculator...');
      try {
        // Essayer de pull la branche spécifiée
        await execAsync(`cd ${balanceCalculatorPath} && git fetch origin && git pull origin ${branch}`);
      } catch (error) {
        console.warn(`⚠️ Branche ${branch} non trouvée, utilisation de la branche par défaut`);
        await execAsync(`cd ${balanceCalculatorPath} && git pull origin`);
      }
    } else {
      console.log('📥 Clonage de balance-calculator...');
      try {
        // Essayer de cloner la branche spécifiée
        await execAsync(`git clone -b ${branch} ${repoUrl} ${balanceCalculatorPath}`);
      } catch (error) {
        console.warn(`⚠️ Branche ${branch} non trouvée, clonage de la branche par défaut`);
        await execAsync(`git clone ${repoUrl} ${balanceCalculatorPath}`);
      }
    }
    
    console.log('📦 Installation des dépendances...');
    await execAsync(`cd ${balanceCalculatorPath} && yarn install`);
    
    // Copier le .env du projet principal vers balance-calculator
    console.log('📋 Copie du fichier .env...');
    await copyEnvFile();
    
    console.log('✅ balance-calculator configuré avec succès');
  } catch (error) {
    console.error('❌ Erreur lors de la configuration de balance-calculator:', error.message);
    // Ne pas faire exit(1) pour permettre au build de continuer
    console.warn('⚠️ Le build continue malgré l\'erreur de balance-calculator');
  }
}

setupBalanceCalculator();

