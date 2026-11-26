import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the browser talks only to Vite; /api is proxied to the backend, so the
// refresh cookie is same-origin and no API key or backend URL is ever shipped to the client.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:4000" },
    },
  },
});
