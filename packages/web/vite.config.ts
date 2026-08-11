import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The app's own version is a build fact, so it is read from package.json rather
// than written into a component where it can drift — it had already drifted to
// "v0.1" against a package.json saying 0.0.1.
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

// Compose sets this to the service name. The default is a container hostname,
// not localhost, because this dev server only ever runs inside the dev stack.
const serverOrigin = process.env.OVERSEER_SERVER_ORIGIN ?? "http://server:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },
  server: {
    // 0.0.0.0 is container-internal. The only route in is compose's
    // "127.0.0.1:5173:5173" mapping, so this is not a public bind.
    host: "0.0.0.0",
    port: 5173,
    // Fail loudly instead of drifting to 5174 and silently serving nothing at
    // the mapped port.
    strictPort: true,
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
