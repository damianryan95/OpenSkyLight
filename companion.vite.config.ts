import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

/**
 * Parent administration web app served by the household server at /admin/.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/companion'),
  // The household server mounts this independent SPA below /admin/; keeping
  // assets under that prefix prevents them colliding with kiosk /assets.
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  build: {
    outDir: resolve(__dirname, 'out/companion'),
    emptyOutDir: true
  },
  server: {
    proxy: { '/api': 'http://localhost:3000' }
  }
})
