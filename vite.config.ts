// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    globals: true,              // enables describe/it/expect without imports
    environment: 'jsdom',       // simulate browser for DOM-related code
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})