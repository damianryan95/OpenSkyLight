import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

/**
 * The same parent administration app, built for the Capacitor native shell
 * rather than for the household server.
 *
 * This exists as a second config purely because of `base`. The server build
 * must stay on `/admin/` or its assets collide with the kiosk's at `/assets/`
 * — a documented invariant that has broken this project before. Inside the
 * native shell there is no server and no kiosk to collide with: the bundle is
 * loaded from the app's own filesystem, where an absolute `/admin/` path
 * resolves to nothing and the app opens blank. Relative paths are the only
 * thing correct in both halves of the shell.
 *
 * Nothing else differs, deliberately. ADR 0005 chose Capacitor so the
 * companion gains a build target rather than a fork; if this file ever starts
 * accumulating behaviour, that decision is being quietly reversed.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/companion'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  build: {
    outDir: resolve(__dirname, 'out/app'),
    emptyOutDir: true
  }
})
