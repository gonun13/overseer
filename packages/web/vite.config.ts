import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Compose sets this to the service name. The default is a container hostname,
// not localhost, because this dev server only ever runs inside the dev stack.
const serverOrigin = process.env.OVERSEER_SERVER_ORIGIN ?? "http://server:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 0.0.0.0 is container-internal. The only route in is compose's
    // "127.0.0.1:5173:5173" mapping, so this is not a public bind.
    host: "0.0.0.0",
    port: 5173,
    // Fail loudly instead of drifting to 5174 and silently serving nothing at
    // the mapped port.
    strictPort: true,
    // Vite's DNS-rebinding guard rejects any Host header it wasn't told about,
    // and the e2e service reaches this server as "web" over the compose network
    // (docker-compose.dev.yml, bin/test-e2e) — without this it gets "Blocked
    // request" instead of the app. Named explicitly rather than `true`: the
    // guard still holds for every other host, localhost included by default.
    allowedHosts: ["web"],
    proxy: {
      "/api": serverOrigin,
      "/ws": { target: serverOrigin.replace(/^http/, "ws"), ws: true },
    },
    watch: {
      // Bind mounts don't deliver inotify reliably; see docker-compose.dev.yml.
      usePolling: process.env.CHOKIDAR_USEPOLLING !== "0",
      interval: 300,
    },
  },
});
