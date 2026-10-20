import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('src'),
  resolve: { alias: { '@': resolve('src') } },
  plugins: [react()],
  server: { strictPort: true },
})
