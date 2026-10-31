// ÁNIMAS server: zero dependencies, Node 18+.
// Static files + Server-Sent Events (shared world) + Gemma 4 writing every ghost under a JSON-Schema grammar.
import http from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const GEMMA_BASE_URL = ((u) => (/^https?:\/\//.test(u) ? u : `http://${u}/v1`).replace(/\/$/, ""))(
  process.env.GEMMA_BASE_URL || "http://localhost:11434/v1");
const GEMMA_MODEL = process.env.GEMMA_MODEL || "gemma4:e4b";
const RUNTIME = process.env.GEMMA_RUNTIME || "ollama"; // ollama | llamacpp | openai
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PUBLIC = path.join(__dirname, "public");
// --- limits (all overridable with env vars) so a crowd, or a bot, can't sink the server
const LIM = {
  clients: +process.env.MAX_CLIENTS || 150,        // open /events streams in total
  clientsPerIp: +process.env.MAX_CLIENTS_PER_IP || 10,   // generous: schools, offices and cafés share one IP
  players: +process.env.MAX_PLAYERS || 60,         // calacas broadcast to everyone
  playersPerIp: +process.env.MAX_PLAYERS_PER_IP || 6,
  moveMs: 80,                                      // one position update per player per 80 ms is plenty (client sends ~120 ms)
  summonQueue: 2,                                  // Gemma writes one summon at a time, at most 2 waiting
  summonsPerHour: +process.env.MAX_SUMMONS_PER_HOUR || 60,
};
const TRUST_PROXY = process.env.TRUST_PROXY === "1"; // only trust X-Forwarded-For behind a real proxy (Render, Fly, Nginx)
const SLOTS = 14;          // ghosts wandering the town at once
const POOL_TARGET = 6;     // ghosts written ahead of time, waiting to arrive

// --------------------------------------------------------------------------- the ghost grammar
export const ITEMS = ["guitar", "photograph", "letter", "pan_dulce", "sugar_skull", "hot_chocolate",
  "candle", "marigold_crown", "ball", "book", "pocket_watch", "wooden_toy"];
export const COLORS = ["rose", "turquoise", "violet", "jade", "crimson", "indigo", "gold", "marigold"];
export const PERSONALITIES = ["gentle", "funny", "grumpy", "shy", "proud", "dramatic", "wise", "mischievous"];
// item comes first so the model commits to the object before writing about it
export const schemaFor = (items = ITEMS, colors = COLORS, personalities = PERSONALITIES) => ({
  type: "object",
  properties: {
    accepted: { type: "boolean" },
    item: { enum: items },
    name: { type: "string", maxLength: 18 },
    from: { type: "string", maxLength: 40 },
    life: { type: "string", maxLength: 100 },
    personality: { enum: personalities },
    color: { enum: colors },
    greeting: { type: "string", maxLength: 170 },
    memory: { type: "string", maxLength: 300 },
    ask: { type: "string", maxLength: 190 },
    thanks: { type: "string", maxLength: 190 },
    epitaph: { type: "string", maxLength: 110 },
  },
  required: ["accepted", "item", "name", "from", "life", "personality", "color", "greeting", "memory", "ask", "thanks", "epitaph"],
});
export const GHOST_SCHEMA = schemaFor();
const ITEM_WORDS = { guitar: "their guitar", photograph: "an old photograph", letter: "a letter", pan_dulce: "a piece of pan dulce (sweet bread)", sugar_skull: "a sugar skull",
  hot_chocolate: "a cup of hot chocolate", candle: "a candle", marigold_crown: "a crown of marigolds", ball: "a ball", book: "a book", pocket_watch: "a pocket watch", wooden_toy: "a wooden toy" };

const RULES = `Fields:
- name: exactly the name given in the seeds (you may add an affectionate title like Don, Doña, Tía, Abuelo, Nonna). Never their job.
- from: where and when they lived, like "Oaxaca, 1950s".
- life: one line about what they did, third person, under 16 words.
- greeting, memory, ask, thanks: spoken BY the ghost, first person, in character, matching the personality. Warm, a little funny, never morbid, nothing graphic.
  greeting: 1-2 sentences saying hello to the little skeleton who found them.
  memory: 2-3 sentences, one vivid concrete memory from their life.
  ask: they miss exactly the object in the item field, they NAME that object, and say why it matters.
  thanks: they receive that same object, name it again, and say goodbye before crossing over.
- item: the object they miss. Choose it first; ask and thanks must be about this exact object and nothing else.
- epitaph: two short poetic lines separated by " / ".
- color: the color of their soul. personality: how they speak.
- accepted: false only if the visitor's text is spam, hateful, sexual, or mocks someone.`;

export const WANDERER_PROMPT = `You write the ghosts (ánimas) who wander Mictlán, the land of the dead, on Día de los Muertos night.
A little skeleton is walking the islands helping lost ghosts cross over. Invent ONE unique ghost from the seeds you are given.
${RULES}
Write in English.`;

export const SUMMON_PROMPT = `You write the ghosts (ánimas) who wander Mictlán, the land of the dead, on Día de los Muertos night.
A living visitor tells you about someone they miss. Turn that person into a gentle ghost who will wander the islands, so strangers can meet them and help them cross over.
Keep only what the visitor said; never invent tragedy. Never use surnames, addresses or phone numbers.
${RULES}
Write in the language the visitor used.`;

const SEEDS = {
  place: ["Riverbend", "Lantern Bay", "Harbor City", "Valle Verde", "Cloudhill", "Highmesa", "Maple Hollow", "Coffee Hills", "Lakeport", "Palm Bay",
    "Old Plaza", "Seven Hills", "Lake Country", "Lemon Coast", "White Town", "Mission Creek", "Saltmarsh", "Copper Canyon", "Rail Junction", "Fig Orchard", "Bell Hill", "Dust Road", "Pine Ridge", "Fisher's Cove", "Market Street"],
  name: ["Lupita", "Chuy", "Beto", "Carmen", "Refugio", "Nacho", "Esperanza", "Tomás", "Marisol", "Pancho", "Inés", "Rigoberto", "Consuelo", "Memo", "Amparo",
    "Rosario", "Ofelia", "Gustavo", "Pilar", "Arturo", "Yolanda", "Chabela", "Teodoro", "Imelda", "Kenji", "Hana",
    "Ama", "Kofi", "Joaquim", "Benedita", "Sal", "Nonna Pina", "Walter", "Dolores", "Felipe", "Cata", "Lencho", "Toña", "Ramón", "Socorro"],
  decade: ["1890s", "1910s", "1920s", "1930s", "1940s", "1950s", "1960s", "1970s", "1980s", "1990s"],
  work: [["baker", "pan_dulce"], ["mariachi guitarist", "guitar"], ["schoolteacher", "book"], ["bus driver", "pocket_watch"], ["seamstress", "marigold_crown"],
    ["fisherman", "candle"], ["radio repairman", "pocket_watch"], ["luchador", "sugar_skull"], ["florist", "marigold_crown"], ["telegraph operator", "letter"],
    ["street photographer", "photograph"], ["candle maker", "candle"], ["librarian", "book"], ["clockmaker", "pocket_watch"], ["soccer goalkeeper", "ball"],
    ["chocolate maker", "hot_chocolate"], ["toymaker", "wooden_toy"], ["poet", "letter"], ["mail carrier", "letter"], ["cinema projectionist", "photograph"],
    ["street food cook", "hot_chocolate"], ["ferry captain", "photograph"], ["grandmother who raised nine kids", "pan_dulce"], ["kid who loved football", "ball"],
    ["serenading street musician", "guitar"], ["sugar skull artisan", "sugar_skull"], ["carpenter", "wooden_toy"], ["night watchman", "candle"]],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const randomSeed = () => { const [work, item] = pick(SEEDS.work); return { name: pick(SEEDS.name), place: pick(SEEDS.place), decade: pick(SEEDS.decade), work, item, personality: pick(PERSONALITIES), color: pick(COLORS) }; };
export const seedPrompt = (sd) => `Seeds: name ${sd.name}, place ${sd.place}, decade ${sd.decade}, work: ${sd.work}, personality: ${sd.personality}. The object they miss is ${ITEM_WORDS[sd.item]}.`;
export const seedSchema = (sd) => schemaFor([sd.item], [sd.color], [sd.personality]);

// --------------------------------------------------------------------------- Gemma (three runtimes, same grammar)
const ROOT = GEMMA_BASE_URL.replace(/\/v1$/, "");
const SAMPLING = { temperature: 0.95, top_p: 0.95 };
async function* lines(body, prefix) {
  const dec = new TextDecoder(); let buf = "";
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true }); let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      let line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (prefix) { if (!line.startsWith(prefix)) continue; line = line.slice(prefix.length).trim(); }
      if (line && line !== "[DONE]") { try { yield JSON.parse(line); } catch {} }
    }
  }
}
const post = (url, payload) => fetch(url, { method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GEMMA_API_KEY || "local"}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(240000) });

export async function* gemmaStream(system, user, schema = GHOST_SCHEMA, maxTokens = 520) {
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  let r;
  if (RUNTIME === "llamacpp") {
    const { prompt } = await (await post(`${ROOT}/apply-template`, { messages })).json();
    // Gemma 4: an empty thought channel = "done thinking", so the grammar governs every token
    r = await post(`${ROOT}/completion`, { prompt: prompt + "<|channel>thought\n<channel|>", json_schema: schema, n_predict: maxTokens, stream: true, ...SAMPLING });
    if (!r.ok) throw new Error(`keeper ${r.status}`);
    for await (const d of lines(r.body, "data:")) { if (d.content) yield d.content; if (d.stop) return; }
  } else if (RUNTIME === "ollama") {
    r = await post(`${ROOT}/api/chat`, { model: GEMMA_MODEL, messages, stream: true, think: false, format: schema, options: { ...SAMPLING, num_predict: maxTokens, num_ctx: 2048 }, keep_alive: "24h" });
    if (!r.ok) throw new Error(`keeper ${r.status}`);
    for await (const d of lines(r.body)) { if (d.message?.content) yield d.message.content; if (d.done) return; }
  } else {
    r = await post(`${GEMMA_BASE_URL}/chat/completions`, { model: GEMMA_MODEL, messages, stream: true, max_tokens: maxTokens, ...SAMPLING,
      response_format: { type: "json_schema", json_schema: { name: "ghost", strict: true, schema } }, chat_template_kwargs: { enable_thinking: false } });
    if (!r.ok) throw new Error(`keeper ${r.status}`);
    for await (const d of lines(r.body, "data:")) { const c = d.choices?.[0]?.delta?.content; if (c) yield c; }
  }
}
export function parseGhost(raw) {
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no ghost in the answer");
  const o = JSON.parse(raw.slice(a, b + 1));
  const s = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  return {
    accepted: o.accepted !== false, name: s(o.name, 18) || "Ánima", from: s(o.from, 40), life: s(o.life, 110),
    personality: PERSONALITIES.includes(o.personality) ? o.personality : "gentle", color: COLORS.includes(o.color) ? o.color : "marigold",
    greeting: s(o.greeting, 200), memory: s(o.memory, 340), item: ITEMS.includes(o.item) ? o.item : "candle",
    ask: s(o.ask, 220), thanks: s(o.thanks, 220), epitaph: s(o.epitaph, 130),
  };
}
export async function writeGhost(system, user, schema = GHOST_SCHEMA) {
  let raw = ""; const t0 = Date.now();
  for await (const t of gemmaStream(system, user, schema)) raw += t;
  const g = parseGhost(raw); g.ms = Date.now() - t0; return g;
}

// --------------------------------------------------------------------------- letters between ghosts
// The mail of Mictlán: Gemma writes a letter from one wandering ghost to another, and the player carries it.
export const LETTER_SCHEMA = {
  type: "object",
  properties: {
    relation: { type: "string", maxLength: 70 },
    ask: { type: "string", maxLength: 170 },
    letter: { type: "string", pattern: "^Dear [^,]{1,30}, .{60,400}$" },
    reply: { type: "string", maxLength: 200 },
  },
  required: ["relation", "ask", "letter", "reply"],
};
export const LETTER_PROMPT = `You write the mail of Mictlán, the land of the dead, on Día de los Muertos night.
Two ghosts are given. Invent ONE warm, specific connection between them (old neighbors, a first love, rivals at the market,
pen pals, a debt never repaid, a song they both knew...). Then:
- relation: that connection in under 10 words, like "they sold bread on the same street in 1962".
- ask: the SENDER, in character, asks the little skeleton mail carrier to deliver a letter to the recipient by name. 1-2 sentences.
- letter: the letter itself, from sender to recipient, 3-5 short sentences, starting with "Dear <recipient name>,". One concrete shared memory. Tender, a little funny, never morbid.
- reply: the RECIPIENT, in character, reacts out loud after reading it. 1-2 sentences.
Example of the shape (do not copy the content):
{"relation":"they raced paper boats in the same canal","ask":"Little one, would you carry this to Rosa? She still owes me a paper boat.","letter":"Dear Rosa, I found the canal where we raced our paper boats, it is full of marigolds now. Yours always sank first, and you always blamed the wind. I kept the last boat you folded for me. Come find me at the dock, I will let you win this time.","reply":"Ha! The wind WAS against me. Tell her... no, I will tell her myself."}
The letter field must be the actual words of the letter, never a description of it.
Write in English.`;
const ghostLine = (g) => `${g.name} (${g.from}; ${g.life}; personality: ${g.personality})`;
export async function writeLetter(from, to) {
  let raw = ""; const t0 = Date.now();
  for await (const t of gemmaStream(LETTER_PROMPT, `Sender: ${ghostLine(from)}\nRecipient: ${ghostLine(to)}`, LETTER_SCHEMA, 420)) raw += t;
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}"); const o = JSON.parse(raw.slice(a, b + 1));
  if (!/^dear /i.test(o.letter || "") || /\b(must|sentences|letter from)\b/i.test(o.letter)) throw new Error("the letter came back as a description");
  const s = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  return { to: to.id, toName: to.name, relation: s(o.relation, 80), ask: s(o.ask, 200), letter: s(o.letter, 460), reply: s(o.reply, 220), ms: Date.now() - t0 };
}

// --------------------------------------------------------------------------- world state
const W = { active: Array(SLOTS).fill(null), pool: [], lanterns: [], freedTonight: 0, night: today(), summoned: null };
const clients = new Set(), players = new Map(), limits = new Map(), tags = new Map();
let tagCount = 0;
// player names: printable, short, never empty (the #tag next to it tells two "Lupe"s apart)
const cleanName = (v) => String(v ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16) || "Calaca";
let dirty = false;
function today() { return new Date().toISOString().slice(0, 10); }
const pub = (g) => g && ({ id: g.id, slot: g.slot, name: g.name, from: g.from, life: g.life, personality: g.personality, color: g.color,
  greeting: g.greeting, memory: g.memory, item: g.item, ask: g.ask, thanks: g.thanks, epitaph: g.epitaph, summoned: !!g.summoned, letter: g.letter || undefined });
const lanternOf = (g) => ({ id: g.id, title: g.name, epitaph: g.epitaph, primary: g.color, item: g.item, slot: g.slot, t: Date.now(), seed: Math.random() });
function broadcast(event, data) { const m = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const r of clients) r.write(m); }

async function load() {
  await mkdir(DATA_DIR, { recursive: true });
  const f = path.join(DATA_DIR, "world.json");
  if (existsSync(f)) Object.assign(W, JSON.parse(await readFile(f, "utf8")));
  else {
    const seed = JSON.parse(await readFile(path.join(__dirname, "seed", "ghosts.json"), "utf8"));
    W.pool = seed.map((g) => ({ ...g, id: g.id || crypto.randomBytes(5).toString("hex") }));
  }
  for (let i = 0; i < SLOTS; i++) if (!W.active[i]) fillSlot(i, false);
  console.log(`👻 ${W.active.filter(Boolean).length} ghosts wandering · ${W.pool.length} waiting · ${W.lanterns.length} lanterns`);
}

function fillSlot(i, announce = true) {
  // recycle freed seed ghosts when the pool runs dry and the keeper is slow
  const g = W.pool.shift() || null;
  if (!g) return;
  g.slot = i; if (g.letter && !W.active.some((r) => r && r.id === g.letter.to)) delete g.letter; W.active[i] = g; dirty = true;
  if (announce) broadcast("ghost", pub(g));
}

let writing = false, failures = 0;
// keep about half of the wandering ghosts holding a letter for someone else who is also wandering
async function letterLoop() {
  if (writing || summonBusy) return;
  const live = W.active.filter(Boolean), withLetter = live.filter((g) => g.letter && W.active.some((r) => r && r.id === g.letter.to));
  if (live.length < 4 || withLetter.length >= Math.floor(live.length / 2)) return;
  const senders = live.filter((g) => !g.letter || !W.active.some((r) => r && r.id === g.letter.to));
  const from = senders[Math.floor(Math.random() * senders.length)], others = live.filter((g) => g !== from && !live.some((x) => x.letter && x.letter.to === g.id));
  if (!from || !others.length) return;
  const to = others[Math.floor(Math.random() * others.length)];
  writing = true;
  try { from.letter = await writeLetter(from, to); dirty = true; broadcast("letter", { id: from.id, letter: from.letter }); console.log(`✉  ${from.name} → ${to.name}: ${from.letter.relation} (${from.letter.ms} ms)`); }
  catch (e) { console.log("letter:", e.message); }
  writing = false;
}
async function keeperLoop() {
  if (writing || summonBusy || W.pool.length >= POOL_TARGET) return;
  writing = true;
  try {
    const sd = randomSeed();
    const g = await writeGhost(WANDERER_PROMPT, seedPrompt(sd), seedSchema(sd));
    delete g.accepted; g.id = crypto.randomBytes(5).toString("hex"); g.seed = sd; g.model = GEMMA_MODEL;
    W.pool.push(g); dirty = true; failures = 0;
    console.log(`✍️  the keeper wrote ${g.name} (${g.from}, ${g.item}) in ${g.ms} ms`);
    for (let i = 0; i < SLOTS; i++) if (!W.active[i]) { fillSlot(i); break; }
  } catch (e) { failures++; if (failures < 3 || failures % 20 === 0) console.log("keeper:", e.message); }
  writing = false;
}
function startLoops() {
setInterval(async () => { if (!dirty) return; dirty = false; await writeFile(path.join(DATA_DIR, "world.json"), JSON.stringify({ ...W, lanterns: W.lanterns.slice(-3000) })); }, 3000).unref();
setInterval(keeperLoop, 4000).unref();
setInterval(letterLoop, 7000).unref();
}

function startPresence() {
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of players) if (now - p.t > 15000) players.delete(id);
  if (now % 60000 < 130) { // once a minute: forget stale rate-limit keys and tags of long-gone players
    for (const [k, t] of limits) if (now - t > 3600e3) limits.delete(k);
    if (tags.size > 5000) for (const id of tags.keys()) if (!players.has(id)) tags.delete(id);
  }
  if (W.night !== today()) { W.night = today(); W.freedTonight = 0; }
  if (clients.size) broadcast("players", [...players].map(([id, p]) => [id, ...p.s, p.name, p.tag]));
}, 120).unref();
setInterval(() => { for (const r of clients) r.write(": ♥\n\n"); }, 20000).unref();
}

// --------------------------------------------------------------------------- http
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon" };
const ipOf = (req) => ((TRUST_PROXY && req.headers["x-forwarded-for"]) || req.socket.remoteAddress || "?").split(",")[0].trim();
async function body(req, limit = 4096) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new Error("too large"); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
const json = (res, code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
const limited = (key, ms) => { const t = limits.get(key) || 0; if (Date.now() - t < ms) return true; limits.set(key, Date.now()); return false; };
const num = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));

async function summon(req, res) {
  const ip = ipOf(req);
  let b; try { b = await body(req); } catch { return json(res, 413, { error: "too large" }); }
  const memory = String(b.memory || "").trim().slice(0, 600);
  if (memory.length < 10) return json(res, 400, { error: "Tell the ofrenda a little more." });
  if (limited("summon:" + ip, 60000)) return json(res, 429, { error: "The candles are still settling. Try again in a minute." });
  const hour = Date.now() - 3600e3; summonLog = summonLog.filter((t) => t > hour);
  if (summonQueue >= LIM.summonQueue || summonLog.length >= LIM.summonsPerHour) { limits.delete("summon:" + ip); return json(res, 503, { error: "The keeper is busy writing other ghosts. Try again in a few minutes." }); }
  summonQueue++; summonLog.push(Date.now());
  while (summonBusy) await new Promise((r) => setTimeout(r, 500));
  summonBusy = true;
  try { while (writing) await new Promise((r) => setTimeout(r, 250)); return await runSummon(req, res, ip, memory); } finally { summonBusy = false; summonQueue--; }
}
let summonBusy = false, summonQueue = 0, summonLog = [];
async function runSummon(req, res, ip, memory) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  const send = (e, d) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
  const heartbeat = setInterval(() => res.write(": writing\n\n"), 15000);
  let raw = "";
  try {
    for await (const t of gemmaStream(SUMMON_PROMPT, memory)) { raw += t; send("token", t); }
    const g = parseGhost(raw);
    if (!g.accepted) { clearInterval(heartbeat); send("refused", { message: "The ofrenda stays quiet." }); return res.end(); }
    delete g.accepted; g.id = crypto.randomBytes(5).toString("hex"); g.summoned = true; g.model = GEMMA_MODEL;
    // the summoned ghost appears at the ofrenda for everyone (slot 0 belongs to the summoned)
    const prev = W.active[0]; if (prev && !prev.summoned) W.pool.unshift(prev);
    g.slot = 0; W.active[0] = g; dirty = true;
    broadcast("ghost", pub(g)); send("ghost", pub(g));
  } catch (e) { limits.delete("summon:" + ip); send("error", { message: "The keeper is asleep (is the local model running?)" }); console.error("summon:", e.message); }
  clearInterval(heartbeat);
  res.end();
}

async function handler(req, res) {
  const origin = req.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (origin) {
    const same = origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
    if (!same && !allowed.includes(origin)) return json(res, 403, { error: "Origin not allowed. Set ALLOWED_ORIGINS to your Vercel origin." });
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/events") {
    const ip = ipOf(req), mine = [...clients].filter((c) => c.ip === ip).length;
    if (clients.size >= LIM.clients || mine >= LIM.clientsPerIp) { // full: tell the client politely, it falls back to solo mode
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.end(`event: full\ndata: ${JSON.stringify({ reason: mine >= LIM.clientsPerIp ? "too many tabs from your network" : "Mictlán is full tonight" })}\n\n`); return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`event: hello\ndata: ${JSON.stringify({ ghosts: W.active.filter(Boolean).map(pub), lanterns: W.lanterns.slice(-1200), freedTonight: W.freedTonight, model: GEMMA_MODEL })}\n\n`);
    clients.add(res); res.ip = ip; req.on("close", () => clients.delete(res)); return;
  }
  if (p === "/api/move" && req.method === "POST") {
    try { const b = await body(req, 600); const id = String(b.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 16), ip = ipOf(req), prev = players.get(id), now = Date.now();
      if (!id) throw 0;
      if (prev && now - prev.t < LIM.moveMs) throw 0;                                   // too fast: drop silently
      if (!prev) {                                                                      // a new calaca: room for it?
        if (players.size >= LIM.players) { res.writeHead(429, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ reason: "Mictlán is full tonight" })); }
        let n = 0; for (const q of players.values()) if (q.ip === ip) n++;
        if (n >= LIM.playersPerIp) { res.writeHead(429, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ reason: "Too many players from your network" })); }
      }
      if (!tags.has(id)) tags.set(id, ++tagCount); // a short number nobody else has, for as long as the server runs
      players.set(id, { ip, id, t: now, name: cleanName(b.name), tag: tags.get(id), s: [num(b.x, -200, 200), num(b.y, -20, 60), num(b.z, -200, 200), num(b.r, -7, 7), num(b.v, 0, 20), num(b.hue, 0, 1), num(b.item, -1, 20), b.dance ? 1 : 0, b.air ? 1 : 0].map((v) => +(+v).toFixed(2)) });
    } catch {}
    res.writeHead(204); return res.end();
  }
  if (p === "/api/free" && req.method === "POST") {
    try {
      const b = await body(req, 600), ip = ipOf(req);
      const i = W.active.findIndex((g) => g && g.id === b.id);
      if (i >= 0 && !limited("free:" + ip, 4000)) {
        const g = W.active[i]; W.active[i] = null;
        const L = lanternOf(g); W.lanterns.push(L); W.freedTonight++; dirty = true;
        if (!g.summoned) W.pool.push({ ...g, letter: undefined, id: crypto.randomBytes(5).toString("hex"), slot: undefined }); // ghosts return on later nights
        broadcast("freed", { id: g.id, lantern: L, freedTonight: W.freedTonight });
        setTimeout(() => { if (!W.active[i]) fillSlot(i); }, 9000);
      }
    } catch {}
    res.writeHead(204); return res.end();
  }
  if (p === "/api/summon" && req.method === "POST") return summon(req, res);
  if (p === "/api/health") return json(res, 200, { ok: true, clients: clients.size, limits: LIM, wandering: W.active.filter(Boolean).length, waiting: W.pool.length, lanterns: W.lanterns.length, players: players.size, freedTonight: W.freedTonight, model: GEMMA_MODEL, runtime: RUNTIME });

  let f = path.normalize(path.join(PUBLIC, p === "/" ? "index.html" : p));
  if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    if ((await stat(f)).isDirectory()) f = path.join(f, "index.html");
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end("Lost in Mictlán"); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await load(); startLoops(); startPresence();
  const server = http.createServer(handler);
  server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 5000; // slow-loris guard (SSE streams are responses, unaffected)
  server.maxConnections = LIM.clients * 3;
  server.listen(PORT, () => console.log(`🌼 ÁNIMAS on http://localhost:${PORT} · keeper ${GEMMA_MODEL} via ${RUNTIME}`));
}
