import { writeFile } from "node:fs/promises";
const value = (process.env.ANIMAS_API_URL || "").trim();
let apiBase = "";
if (value) { const u = new URL(value); if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.pathname !== "/") throw new Error("ANIMAS_API_URL must be an HTTPS origin, e.g. https://your-service.onrender.com"); apiBase = u.origin; }
await writeFile(new URL("../public/config.js", import.meta.url), "window.ANIMAS_CONFIG = " + JSON.stringify({ apiBase }) + ";\n");
console.log(apiBase ? "AI backend configured: " + apiBase : "Static mode: no external AI backend configured");
