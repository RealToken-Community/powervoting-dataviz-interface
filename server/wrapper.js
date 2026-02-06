// Wrapper pour exécuter balance-calculator avec des paramètres non-interactifs
import { spawn } from 'child_process';
import readline from 'readline';

/**
 * Exécute balance-calculator avec des réponses automatiques
 */
export async function runBalanceCalculator(task, options = {}) {
  return new Promise((resolve, reject) => {
    const cwd = process.env.BALANCE_CALCULATOR_PATH || './balance-calculator';
    const proc = spawn('yarn', ['start'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let output = '';
    let errorOutput = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
      console.log(data.toString());
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

    // Envoyer les réponses automatiques
    // Note: Cette approche est limitée car inquirer peut être complexe
    // Une meilleure solution serait de modifier balance-calculator pour accepter des paramètres CLI
    setTimeout(() => {
      if (task === 'GetBalancesREG') {
        proc.stdin.write('GetBalancesREG\n');
      } else if (task === 'CalculatePowerVotingREG') {
        proc.stdin.write('CalculatePowerVotingREG\n');
      }
    }, 1000);

    proc.stdin.end();
  });
}

