import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), {
    name: 'canopy-android-entry',
    transform(code, id) {
      if (id.endsWith('/src/components/ProfileShare.tsx') || id.endsWith('/src/components/EventCard.tsx')) return code.replaceAll('window.location.origin', JSON.stringify('https://zinc-pod-arch.rick.runwingman.com'));
    },
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https: wss:; img-src 'self' https: data: blob:; media-src 'self' https: blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">`).replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" src="/android/bridge.ts"></script>') },
  }],
  build: { outDir: 'android/app/build/webAssets/www', emptyOutDir: true },
});
