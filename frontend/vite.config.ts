import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Precache only the built app shell (JS/CSS/HTML/icons). File uploads,
      // downloads, and API calls all go through the network directly and
      // are never touched by the service worker — this app moves large
      // original-quality media and must never serve a stale/cached copy of
      // it, and background streams must not be interceptable/bufferable by
      // the SW.
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: "Sharizz",
        short_name: "Sharizz",
        description: "Transfer original-quality photos and videos through temporary storage rooms.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0a0a0c",
        theme_color: "#0a0a0c",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
  },
});
