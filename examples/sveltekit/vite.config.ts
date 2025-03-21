import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
    resolve: {
        preserveSymlinks: true,
    },
    server: {
      port: 3001,
    },
});
