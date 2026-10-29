// Writes letters between the first ghosts of the seed so the town's mail is busy from the first visit.
import { readFile, writeFile } from "node:fs/promises";
import { writeLetter } from "../server.js";
const P = new URL("../seed/ghosts.json", import.meta.url);
const G = JSON.parse(await readFile(P, "utf8"));
const PAIRS = [[0, 5], [2, 9], [4, 11], [6, 1], [8, 13], [10, 3], [12, 7]]; // sender → recipient, all among the first 14 (the ones that start wandering)
for (let pass = 0; pass < 3; pass++) for (const [a, b] of PAIRS) {
  if (G[a].letter) continue;
  try { G[a].letter = await writeLetter(G[a], G[b]); await writeFile(P, JSON.stringify(G, null, 1));
    console.log(`${G[a].name} → ${G[b].name} (${(G[a].letter.ms / 1000).toFixed(0)}s) ${G[a].letter.relation} | ${G[a].letter.letter.slice(0, 120)}`); }
  catch (e) { console.log("retry later", a, e.message); }
}
