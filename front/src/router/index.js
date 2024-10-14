// router.js ou index.js
import { createRouter, createWebHistory } from 'vue-router';
import LiveTiming from '../components/LiveTiming.vue';

const routes = [
  {
    path: '/live-timing/:saison/:manche',
    component: LiveTiming,
    props: true // Passe les paramètres comme props au composant
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
