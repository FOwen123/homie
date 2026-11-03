import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `bunx wrangler pages dev` serves the API functions on 8788; the Vite dev server forwards /api there.
  server: { proxy: { '/api': 'http://localhost:8788' } },
})
