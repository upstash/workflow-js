import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    nextjs: "./platforms/nextjs.ts",
    h3: "./platforms/h3.ts",
    svelte: "./platforms/svelte.ts",
    solidjs: "./platforms/solidjs.ts",
    hono: "./platforms/hono.ts",
    cloudflare: "./platforms/cloudflare.ts",
    astro: "./platforms/astro.ts",
    express: "./platforms/express.ts",
  },
  format: ["cjs", "esm"],
  clean: true,
  dts: true,
  // This should optimally be an optional peer dependency,
  // we can change it in a future release
  external: ["next"],
});
