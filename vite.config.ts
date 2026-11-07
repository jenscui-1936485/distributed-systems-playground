import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

// Relative base keeps local previews and static hosts working.
// Set VITE_BASE=/repo-name/ when publishing a GitHub project site.
export default defineConfig({
  plugins: [react()],
  base: env?.VITE_BASE || './',
});
