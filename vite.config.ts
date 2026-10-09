import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  root: "frontend",
  envDir: process.cwd(),
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
  // Open pages may request their version's lazy graph chunk after a rebuild.
  // Keep content-hashed assets until those pages are refreshed; never purge during serving.
  build: { outDir: "../dist", emptyOutDir: false },
});
