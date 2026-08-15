import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The base path can be overridden at build time (e.g. the GitHub Pages deploy
// sets VITE_BASE to "/awesome-selfhosted/"); it defaults to "/" for local dev.
// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
})
