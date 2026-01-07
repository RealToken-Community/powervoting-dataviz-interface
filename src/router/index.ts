import { createRouter, createWebHistory } from 'vue-router'
import GenerateView from '../views/GenerateView.vue'
import UploadView from '../views/UploadView.vue'
import AnalysisView from '../views/AnalysisView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/generate',
      name: 'generate',
      component: GenerateView,
    },
    {
      path: '/',
      name: 'upload',
      component: UploadView,
    },
    {
      path: '/analysis',
      name: 'analysis',
      component: AnalysisView,
    },
  ],
})

export default router
