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
            <h3>⚙️ {{ t('documentation.generate') }}</h3>
            <RouterLink to="/generate" class="doc-link">{{ t('documentation.generateAccess') }}</RouterLink>
          </div>
          <div class="doc-section-content">
            <p v-html="t('documentation.generateIntro')"></p>
            <div class="doc-features">
              <div class="doc-feature">
                <span class="doc-feature-icon">1️⃣</span>
                <div v-html="t('documentation.generateFeature1')"></div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">2️⃣</span>
                <div v-html="t('documentation.generateFeature2')"></div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">3️⃣</span>
                <div v-html="t('documentation.generateFeature3')"></div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">4️⃣</span>
                <div v-html="t('documentation.generateFeature4')"></div>
              </div>
            </div>
            <div class="doc-warning" v-html="t('documentation.generateWarning')"></div>
          </div>
        </div>

        <!-- Section Upload -->
        <div class="doc-section">
          <div class="doc-section-header">
            <h3>📤 {{ t('documentation.upload') }}</h3>
            <RouterLink to="/upload" class="doc-link">{{ t('documentation.generateAccess') }}</RouterLink>
          </div>
          <div class="doc-section-content">
            <p v-html="t('documentation.uploadIntro')"></p>
            <div class="doc-features">
              <div class="doc-feature">
                <span class="doc-feature-icon">📁</span>
                <div v-html="t('documentation.uploadFeature1')"></div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">✅</span>
                <div v-html="t('documentation.uploadFeature2')"></div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">🔄</span>
                <div v-html="t('documentation.uploadFeature3')"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Section Analysis -->
        <div class="doc-section">
          <div class="doc-section-header">
            <h3>📊 {{ t('documentation.analysis') }}</h3>
            <RouterLink to="/analysis" class="doc-link">{{ t('documentation.generateAccess') }}</RouterLink>
          </div>
          <div class="doc-section-content">
            <p v-html="t('documentation.analysisIntro')"></p>
            <div class="doc-features">
              <div class="doc-feature">
                <span class="doc-feature-icon">📈</span>
                <div v-html="t('documentation.analysisFeature1')"></div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">🔍</span>
                <div v-html="t('documentation.analysisFeature2')"></div>
              </div>
              <div class="doc-feature">
                <span class="doc-feature-icon">💾</span>
                <div v-html="t('documentation.analysisFeature3')"></div>
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
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
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
  background: var(--primary-color);
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
  background: var(--primary-color);
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

