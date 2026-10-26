import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// BASE_PATH is the URL path the site is served from: "/<repo>/" on GitHub Pages (set by the deploy workflow),
// "/" for local dev.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
