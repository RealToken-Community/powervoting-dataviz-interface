<template>
  <div class="documentation-view">
    <div class="documentation-card">
      <div class="card-header">
        <h2>📚 Documentation</h2>
        <p>Guide rapide pour comprendre les fonctionnalités de l'interface</p>
      </div>

      <div class="documentation-content">
        <!-- Section Generate -->
        <div class="doc-section">
          <div class="doc-section-header">
            <h3>⚙️ Génération (Generate)</h3>
            <RouterLink to="/generate" class="doc-link">Accéder à la page →</RouterLink>
          </div>
          <div class="doc-section-content">
            <p>
              La page <strong>Génération</strong> permet de créer des données de test pour les balances REG et le power voting 
              en utilisant l'outil <code>balance-calculator</code>.
            </p>
            <div class="doc-features">
              <div class="doc-feature">
                <span class="doc-feature-icon">1️⃣</span>
                <div>
                  <strong>Clone</strong> - Cloner et configurer le projet balance-calculator depuis un dépôt Git
                </div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">2️⃣</span>
                <div>
                  <strong>Environnement</strong> - Configurer les variables d'environnement nécessaires (clés API)
                </div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">3️⃣</span>
                <div>
                  <strong>Configuration</strong> - Modifier les options de calcul (optionsModifiers.ts)
                </div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">4️⃣</span>
                <div>
                  <strong>Lancer balance-calculator</strong> - Exécuter l'outil en mode interactif pour générer les fichiers de données
                </div>
              </div>
            </div>
            <div class="doc-warning">
              <strong>⚠️ Important :</strong> Cette interface est uniquement destinée aux tests. Ne jamais créer de données pour snapshot depuis cette page.
            </div>
          </div>
        </div>

        <!-- Section Upload -->
        <div class="doc-section">
          <div class="doc-section-header">
            <h3>📤 Upload</h3>
            <RouterLink to="/" class="doc-link">Accéder à la page →</RouterLink>
          </div>
          <div class="doc-section-content">
            <p>
              La page <strong>Upload</strong> permet de charger des fichiers de données existants (CSV ou JSON) 
              pour les analyser et les visualiser.
            </p>
            <div class="doc-features">
              <div class="doc-feature">
                <span class="doc-feature-icon">📁</span>
                <div>
                  <strong>Import de fichiers</strong> - Télécharger des fichiers de balances REG ou de power voting
                </div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">✅</span>
                <div>
                  <strong>Validation</strong> - Vérification automatique du format et de la structure des données
                </div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">🔄</span>
                <div>
                  <strong>Transformation</strong> - Conversion automatique des données pour l'analyse
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Section Analysis -->
        <div class="doc-section">
          <div class="doc-section-header">
            <h3>📊 Analysis</h3>
            <RouterLink to="/analysis" class="doc-link">Accéder à la page →</RouterLink>
          </div>
          <div class="doc-section-content">
            <p>
              La page <strong>Analysis</strong> offre des outils de visualisation et d'analyse des données de power voting 
              et de balances REG chargées.
            </p>
            <div class="doc-features">
              <div class="doc-feature">
                <span class="doc-feature-icon">📈</span>
                <div>
                  <strong>Graphiques</strong> - Visualisation des données sous forme de graphiques interactifs
                </div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">🔍</span>
                <div>
                  <strong>Analyse détaillée</strong> - Exploration des données avec filtres et recherches
                </div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">💾</span>
                <div>
                  <strong>Export</strong> - Possibilité d'exporter les résultats d'analyse
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<style scoped>
.documentation-view {
  animation: fadeIn 0.5s ease;
}

.documentation-card {
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
  padding: 2.5rem;
  box-shadow: var(--shadow-xl);
}

.card-header {
  text-align: center;
  margin-bottom: 3rem;
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

.documentation-content {
  display: flex;
  flex-direction: column;
  gap: 2.5rem;
}

.doc-section {
  background: var(--bg-tertiary);
  border-radius: 0.75rem;
  border: 1px solid var(--border-color);
  padding: 2rem;
  transition: all 0.3s ease;
}

.doc-section:hover {
  border-color: var(--primary-color);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.doc-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.doc-section-header h3 {
  font-size: 1.5rem;
  color: var(--text-primary);
  margin: 0;
}

.doc-link {
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
  color: white;
  text-decoration: none;
  border-radius: 0.5rem;
  font-weight: 500;
  font-size: 0.875rem;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.doc-link:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.doc-section-content {
  color: var(--text-secondary);
  line-height: 1.8;
}

.doc-section-content p {
  margin-bottom: 1.5rem;
  font-size: 1.05rem;
}

.doc-section-content strong {
  color: var(--text-primary);
  font-weight: 600;
}

.doc-section-content code {
  background: var(--bg-primary);
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
  color: var(--primary-color);
  border: 1px solid var(--border-color);
}

.doc-features {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  margin-top: 1.5rem;
}

.doc-feature {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem;
  background: var(--bg-secondary);
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  transition: all 0.3s ease;
}

.doc-feature:hover {
  border-color: var(--primary-color);
  background: var(--card-bg);
}

.doc-feature-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
  line-height: 1;
}

.doc-feature div {
  flex: 1;
}

.doc-feature strong {
  color: var(--text-primary);
  display: block;
  margin-bottom: 0.25rem;
}

.doc-warning {
  margin-top: 1.5rem;
  padding: 1rem 1.25rem;
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 0.5rem;
  color: var(--text-primary);
}

.doc-warning strong {
  color: #ff9800;
}

@media (max-width: 768px) {
  .documentation-card {
    padding: 1.5rem;
  }

  .card-header h2 {
    font-size: 1.5rem;
  }

  .doc-section {
    padding: 1.5rem;
  }

  .doc-section-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .doc-link {
    width: 100%;
    text-align: center;
  }
}
</style>

