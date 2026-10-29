// Asks Gemma to write the first ghosts so the islands aren't empty.  npm run seed  (same env vars as the server)
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { writeGhost, WANDERER_PROMPT, randomSeed, seedPrompt, seedSchema } from "../server.js";
const OUT = new URL("../seed/ghosts.json", import.meta.url);
const N = Number(process.argv[2] || 24);
const out = existsSync(OUT) ? JSON.parse(await readFile(OUT, "utf8")) : [];
const used = new Set(out.map((g) => g.seed?.work)), names = new Set(out.map((g) => g.seed?.name));
while (out.length < N) {
  let sd = randomSeed(); for (let k = 0; k < 20 && (used.has(sd.work) || names.has(sd.name)); k++) sd = randomSeed(); used.add(sd.work); names.add(sd.name);
  try {
    const g = await writeGhost(WANDERER_PROMPT, seedPrompt(sd), seedSchema(sd));
    delete g.accepted; g.id = "s" + out.length.toString(36).padStart(2, "0"); g.seed = sd; g.model = process.env.GEMMA_MODEL || "gemma4:e4b";
    out.push(g); await writeFile(OUT, JSON.stringify(out, null, 1));
    console.log(`${out.length} ${(g.ms / 1000).toFixed(1)}s ${g.name} · ${g.from} · ${g.personality} · ${g.item} | ${g.ask}`);
  } catch (e) { console.log("retry:", e.message); }
}
