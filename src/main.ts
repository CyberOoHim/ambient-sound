import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')!,
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const baseUrl = import.meta.env.BASE_URL || './';
    const swUrl = new URL('sw.js', new URL(baseUrl, window.location.href)).href;
    navigator.serviceWorker.register(swUrl, { scope: baseUrl }).catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

export default app;
