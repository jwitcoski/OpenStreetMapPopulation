import { defineConfig } from 'vite';

// GitHub project Pages: https://jwitcoski.github.io/OpenStreetMapPopulation/
export default defineConfig({
  base: '/OpenStreetMapPopulation/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
