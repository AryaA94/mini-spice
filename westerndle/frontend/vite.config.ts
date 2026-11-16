import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // In dev, the FastAPI backend runs on :8000.
  server: { proxy: { "/api": "http://localhost:8000" } },
});
