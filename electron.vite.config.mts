import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Terminals started by VS Code extensions can inherit this variable, which makes
// Electron run as plain Node and the app fail to start.
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()]
  }
})
