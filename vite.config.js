import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'client/index.html'
    }
  },
  server: {
    port: 3000,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      // Proxy map config requests to the game server
      '/config': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Proxy API requests to the game server
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});