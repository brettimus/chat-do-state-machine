import path, { resolve } from "node:path";
import fs, { readFileSync, existsSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

// NOTE - We need this plugin to handle the raw SQL files of our migrations with vite
const handleSql: Plugin = {
  name: "handle-sql-files",
  transform(code, id) {
    if (id.endsWith(".sql")) {
      return {
        code: `export default ${JSON.stringify(readFileSync(id, "utf-8"))};`,
        map: null,
      };
    }
  },

  resolveId(id) {
    if (id.endsWith(".sql") || id.includes(".sql?raw")) {
      const cleanId = id.replace("?raw", "");
      const absolutePath = resolve(cleanId);
      if (existsSync(absolutePath)) {
        return absolutePath;
      }
    }
  },
};

export default defineConfig({
  plugins: [handleSql, cloudflare(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
