// Wrapper pour exécuter balance-calculator avec des paramètres non-interactifs
import { spawn } from 'child_process';
import readline from 'readline';

/**
 * Exécute balance-calculator GetBalancesREG avec des réponses automatiques
 * @param {Object} options - Options de configuration
 * @param {string[]} options.networks - Réseaux sélectionnés (gnosis, ethereum, polygon)
 * @param {Object} options.dexs - DEX sélectionnés par réseau
 * @param {string} options.startDate - Date de début (YYYY-MM-DD)
 * @param {string} options.endDate - Date de fin (YYYY-MM-DD)
 * @param {string} options.snapshotTime - Heure du snapshot (HH:MM)
 * @param {string} options.targetAddress - Adresse cible ou "all"
 * @param {boolean} options.useMock - Utiliser des données mock
 * @param {string} cwd - Répertoire de travail
 */
export async function runGetBalancesREG(options, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yarn', ['start'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let output = '';
    let errorOutput = '';
    let step = 0;
    const steps = [];

    // Construire la séquence de réponses
    // 1. Sélectionner la tâche
    steps.push(() => proc.stdin.write('GetBalancesREG\n'));

    // 2. Utiliser mock?
    if (options.useMock) {
      steps.push(() => proc.stdin.write('y\n'));
    } else {
      steps.push(() => proc.stdin.write('n\n'));
      
      // 3. Sélectionner les réseaux
      const networkMap = { gnosis: 'gnosis', ethereum: 'ethereum', polygon: 'polygon' };
      const networkChoices = options.networks.map(n => networkMap[n] || n);
      // Envoyer les sélections (format dépend de inquirer)
      steps.push(() => {
        // Pour checkbox, envoyer les indices séparés par espace puis Enter
        const allNetworks = ['gnosis', 'ethereum', 'polygon'];
        const indices = networkChoices.map(n => allNetworks.indexOf(n)).filter(i => i >= 0);
        proc.stdin.write(indices.join(' ') + '\n');
        proc.stdin.write('\n'); // Confirmer
      });

      // 4. Sélectionner les DEX par réseau
      // Cette partie est complexe car elle dépend de la structure de inquirer
      // Pour l'instant, on envoie les valeurs par défaut
    }

    // 5. Plage de dates
    if (options.startDate) {
      steps.push(() => proc.stdin.write(options.startDate + '\n'));
    }
    if (options.endDate) {
      steps.push(() => proc.stdin.write(options.endDate + '\n'));
    }
    if (options.snapshotTime) {
      steps.push(() => proc.stdin.write(options.snapshotTime + '\n'));
    }

    // 6. Adresse cible
    if (options.targetAddress) {
      steps.push(() => proc.stdin.write(options.targetAddress + '\n'));
    }

    proc.stdout.on('data', (data) => {
      output += data.toString();
      const text = data.toString();
      
      // Détecter les prompts et envoyer les réponses
      if (text.includes('askTask') || text.includes('Quelle tâche')) {
        setTimeout(() => steps[step++]?.(), 500);
      } else if (text.includes('askUseMock') || text.includes('mock')) {
        setTimeout(() => steps[step++]?.(), 500);
      } else if (text.includes('askDexsNetwork') || text.includes('réseaux')) {
        setTimeout(() => steps[step++]?.(), 500);
      } else if (text.includes('askTargetAddress') || text.includes('adresse')) {
        setTimeout(() => steps[step++]?.(), 500);
      }
    });

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error(data.toString());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`Process exited with code ${code}: ${errorOutput}`));
      }
    });

    // Démarrer la séquence
    setTimeout(() => steps[step++]?.(), 1000);
  });
}

