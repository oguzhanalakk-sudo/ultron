import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('electron/main.ts') } }, plugins: [externalizeDepsPlugin()] },
  preload: { build: { rolldownOptions: { input: resolve('electron/preload.ts'), output: { format: 'cjs', entryFileNames: 'preload.cjs' } } }, plugins: [externalizeDepsPlugin()] },
  renderer: { root: resolve('src'), build: { rollupOptions: { input: resolve('src/index.html') } }, resolve: { alias: { '@': resolve('src') } }, plugins: [react()] },
})
