import { createRouter, createWebHistory } from 'vue-router'
import DocumentationView from '../views/DocumentationView.vue'
import GenerateView from '../views/GenerateView.vue'
import UploadView from '../views/UploadView.vue'
import AnalysisView from '../views/AnalysisView.vue'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/documentation',
      name: 'documentation',
      component: DocumentationView,
    },
    {
      path: '/generate',
      name: 'generate',
      component: GenerateView,
    },
    {
      path: '/upload',
      name: 'upload',
      component: UploadView,
    },
    {
      path: '/analysis',
      name: 'analysis',
      component: AnalysisView,
    },
    {
      path: '/:date',
      name: 'homeSnapshot',
      component: HomeView,
      props: true,
    },
  ],
})

export default router
