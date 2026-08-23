import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * Content build: single IIFE bundle (classic script, no ES module) so it can be
 * declared in manifest content_scripts. Tailwind CSS is inlined via ?inline import
 * and injected into the Shadow Root at runtime (overlay/styles.css).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.tsx'),
      formats: ['iife'],
      name: 'StyleLensContent',
      fileName: () => 'content.js',
    },
  },
})
