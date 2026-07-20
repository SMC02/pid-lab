import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // For GitHub Pages deployment set base to "/pid-lab/"; Vercel needs no change.
  base: "./",
});
