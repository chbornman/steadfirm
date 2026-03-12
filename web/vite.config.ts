import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    include: [
      '@vidstack/react',
      'react-pdf',
      'pdfjs-dist',
    ],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api/auth': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Disable buffering for SSE streaming endpoints
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const contentType = proxyRes.headers['content-type'] ?? '';
            if (contentType.includes('text/event-stream')) {
              // Prevent http-proxy from buffering the SSE stream
              proxyRes.headers['Cache-Control'] = 'no-cache';
              proxyRes.headers['X-Accel-Buffering'] = 'no';
            }
          });
        },
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-antd': ['antd'],
          'vendor-tanstack': ['@tanstack/react-router', '@tanstack/react-query'],
          'vendor-motion': ['framer-motion'],
        },
      },
    },
  },
});
