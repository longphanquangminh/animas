// docs/demo.html: one self-contained file that runs without a server or a model.
// The ghosts are the ones Gemma 4 wrote into seed/ghosts.json; summoning needs the real server.
import { readFile, writeFile } from "node:fs/promises";
const R = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");
const [html, main, seed] = await Promise.all([R("public/index.html"), R("public/main.js"), R("seed/ghosts.json")]);
const ghosts = JSON.parse(seed).map(({ id, name, from, life, personality, color, greeting, memory, item, ask, thanks, epitaph, letter }) => ({ id, name, from, life, personality, color, greeting, memory, item, ask, thanks, epitaph, letter: letter && { to: letter.to, toName: letter.toName, relation: letter.relation, ask: letter.ask, letter: letter.letter, reply: letter.reply } }));
const prelude = `<script>
for (const k of ["sessionStorage", "localStorage"]) { let ok = false; try { window[k].setItem("__t", "1"); window[k].removeItem("__t"); ok = true; } catch {}
  if (!ok) { const m = new Map(); try { Object.defineProperty(window, k, { configurable: true, value: { getItem: (x) => (m.has(x) ? m.get(x) : null), setItem: (x, v) => m.set(x, String(v)), removeItem: (x) => m.delete(x) } }); } catch {} } }
window.__DEMO = { ghosts: ${JSON.stringify(ghosts)} };
window.EventSource = class { constructor() { setTimeout(() => this.onerror && this.onerror(new Event("error")), 20); } addEventListener() {} close() {} };
const _f = window.fetch.bind(window);
window.fetch = async (u, o) => { u = String(u);
  if (u.endsWith("/api/summon")) return new Response(JSON.stringify({ error: "Summoning needs the real keeper. Run the repo with npm start and Gemma." }), { status: 503 });
  if (u.startsWith("/api/") || u.endsWith("seed-ghosts.json")) return new Response(null, { status: 204 });
  return _f(u, o); };
</script>`;
const badge = `<div id="demo-badge" style="position:fixed;z-index:60;left:50%;top:6px;transform:translateX(-50%);padding:3px 10px;font-size:8.5px!important;opacity:.8;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis;border-radius:999px;background:rgba(255,140,26,.14);border:1px solid rgba(255,140,26,.4);color:#ffd9a8;font:9.5px 'Geist Mono',monospace;letter-spacing:.14em;text-transform:uppercase;pointer-events:none">static demo · ${ghosts.length} ghosts & ${ghosts.filter((g) => g.letter).length} letters written by Gemma 4 · solo</div>`;
const out = html.replace("</head>", prelude + "</head>")
  .replace('<script type="module" src="/main.js"></script>', `<script type="module">\n${main.replace(/<\/script/gi, "<\\/script")}\n</script>` + badge);
await writeFile(new URL("../docs/demo.html", import.meta.url), out);
console.log("docs/demo.html", (out.length / 1024).toFixed(0), "KB,", ghosts.length, "ghosts");
