import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        "capture-overlay": "capture-overlay.html",
        editor: "editor.html",
        "window-capture": "window-capture.html",
        library: "library.html",
      },
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-ui": [
            "lucide-react",
            "react-markdown",
            "react-syntax-highlighter",
            "dompurify",
          ],
          "vendor-konva": ["konva", "react-konva"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
