import 'maplibre-gl/dist/maplibre-gl.css';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register VitePWA Workbox service worker for offline forest caching
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);
