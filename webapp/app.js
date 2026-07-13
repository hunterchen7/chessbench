import { renderBoard, parseFen } from "./board.js";

const state = { runs: [], puzzleIndex: new Map(), tIndex: undefined, tCache: new Map() };
const app = () => document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => (x * 100).toFixed(1) + "%";

// ---- lightweight FEN stepper for game replay ----
// board.js has no move engine, so we reconstruct positions by applying UCI moves
// to a {square: pieceChar} map (the same shape parseFen returns).
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

// Apply one UCI move to `map` in place. Handles normal moves, captures,
// promotions, en passant, and castling. Degrades gracefully (never throws) on
// malformed input — worst case it leaves the position unchanged.
function applyUci(map, uci) {
  if (!uci || typeof uci !== "string" || uci.length < 4) return map;
  const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4];
  const piece = map[from];
  if (!piece) return map; // nothing to move — bail without throwing
  const white = piece === piece.toUpperCase();
  const kind = piece.toLowerCase();
  const fromFile = from.charCodeAt(0), toFile = to.charCodeAt(0);
  const rank = from[1];

  // En passant: a pawn moving diagonally onto an empty square captures the
  // pawn that sits on the destination file at the origin's rank.
  if (kind === "p" && fromFile !== toFile && !map[to]) {
    delete map[to[0] + rank];
  }
  // Castling: the king moves two files; move the matching rook too.
  if (kind === "k" && Math.abs(toFile - fromFile) === 2) {
    if (toFile > fromFile) { // king-side
      const rk = "h" + rank, rd = "f" + rank;
      if (map[rk]) { map[rd] = map[rk]; delete map[rk]; }
    } else { // queen-side
      const rk = "a" + rank, rd = "d" + rank;
      if (map[rk]) { map[rd] = map[rk]; delete map[rk]; }
    }
  }
  delete map[from];
  map[to] = (promo && kind === "p") ? (white ? promo.toUpperCase() : promo.toLowerCase()) : piece;
  return map;
}

// Build a FEN piece-placement string from a {square: pieceChar} map.
function fenFromMap(map) {
  const files = "abcdefgh";
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let row = "", empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = map[files[f] + r];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; }
      else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join("/");
}

// Precompute placement FENs: fens[0] = start, fens[k] = after k plies.
function buildFens(moves, startFen) {
  const start = startFen || START_FEN;   // opening-book games carry a custom start
  const fens = [fenFromMap(parseFen(start).grid)];
  const map = parseFen(start).grid;
  for (const m of moves || []) {
    applyUci(map, m && m.uci);
    fens.push(fenFromMap(map));
  }
  return fens;
}

// ---- tournament data loaders (lazy; missing data must not crash the app) ----
async function fetchTournamentIndex() {
  if (state.tIndex !== undefined) return state.tIndex;
  try {
    state.tIndex = await fetch("data/tournaments/index.json")
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  } catch (e) { state.tIndex = null; }
  return state.tIndex;
}
async function fetchTournament(file) {
  if (state.tCache.has(file)) return state.tCache.get(file);
  const data = await fetch("data/tournaments/" + file)
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  state.tCache.set(file, data);
  return data;
}

// Compact "2026-07-13 19:54" from an ISO timestamp.
const fmtWhen = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");

// Difficulty tiers, easiest → hardest.
const TIER_ORDER = ["beginner", "novice", "intermediate", "advanced", "expert", "master"];
const CONDITION_LABELS = { free_form: "Free-form", legal_list: "Legal list" };

// Human-readable label for a run's condition (mode). Falls back to the slug.
const condMode = (cond) => CONDITION_LABELS[cond?.legality] || cond?.slug || "—";

// puzzle-Elo cell: shows ± only when we have a finite CI; "≥" when unbounded.
function eloCell(s) {
  const [lo, hi] = s.puzzle_elo_ci || [];
  if (!s.puzzle_elo_bounded) return `≥${s.puzzle_elo.toFixed(0)}`;
  const hasCI = typeof lo === "number" && typeof hi === "number";
  return hasCI
    ? `${s.puzzle_elo.toFixed(0)} <span class="ci">±${((hi - lo) / 2).toFixed(0)}</span>`
    : `${s.puzzle_elo.toFixed(0)}`;
}

let lbView = "flat"; // leaderboard view: "flat" | "grouped"

async function loadData() {
  const idx = await fetch("data/index.json").then((r) => r.json());
  state.runs = [];
  for (const meta of idx.runs) {
    try {
      state.runs.push(await fetch("data/runs/" + meta.file).then((r) => r.json()));
    } catch (e) { console.warn("failed to load", meta.file, e); }
  }
  const pi = new Map();
  for (const run of state.runs) {
    for (const it of run.items) {
      let e = pi.get(it.puzzle_id);
      if (!e) { e = { position: it, answers: [] }; pi.set(it.puzzle_id, e); }
      e.answers.push({ model: run.model, condition: run.condition.slug, item: it });
    }
  }
  state.puzzleIndex = pi;
}

// ---- reusable SVG line chart ----
function eloChart(items) {
  const W = 720, H = 260, pad = 40;
  const xs = items.map((_, i) => i);
  const ys = items.map((it) => it.seq_elo);
  const minY = Math.min(...ys, 800) - 50, maxY = Math.max(...ys, 1600) + 50;
  const X = (i) => pad + (i / Math.max(1, items.length - 1)) * (W - 2 * pad);
  const Y = (v) => H - pad - ((v - minY) / (maxY - minY)) * (H - 2 * pad);
  const line = items.map((it, i) => `${X(i)},${Y(it.seq_elo)}`).join(" ");
  const dots = items.map((it, i) =>
    `<circle cx="${X(i)}" cy="${Y(it.seq_elo)}" r="3" class="${it.solved ? "ok" : "no"}"><title>${esc(it.puzzle_id)} (${it.rating}) ${it.solved ? "solved" : "failed"} -> ${it.seq_elo}</title></circle>`).join("");
  const yticks = [minY, (minY + maxY) / 2, maxY].map((v) =>
    `<text x="6" y="${Y(v) + 4}" class="axis">${Math.round(v)}</text><line x1="${pad}" y1="${Y(v)}" x2="${W - pad}" y2="${Y(v)}" class="grid"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${yticks}
    <polyline points="${line}" class="eloline"/>${dots}
    <text x="${W / 2}" y="${H - 6}" class="axis" text-anchor="middle">puzzles, easy → hard</text></svg>`;
}

// ---- views ----
function runCell(r) {
  const s = r.summary;
  return `<td class="r">${eloCell(s)}</td>
    <td class="r">${pct(s.solve_rate)}</td>
    <td class="r">${pct(s.first_move_legal_rate)}</td>
    <td class="r">${s.n}</td>
    <td class="r small">${s.cost_usd != null ? "$" + s.cost_usd.toFixed(4) : "—"}</td>`;
}
const lbHead = `<thead><tr><th>#</th><th>model</th><th>mode</th><th class="r">puzzle-Elo</th>
  <th class="r">solved</th><th class="r">legal</th><th class="r">n</th><th class="r">cost</th></tr></thead>`;

// Flat ranking: one row per run, sorted by Elo.
function lbFlat(runs) {
  const rows = runs.slice().sort((a, b) => b.summary.puzzle_elo - a.summary.puzzle_elo);
  return `<table class="lb">${lbHead}<tbody>
    ${rows.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td><a href="#/model/${encodeURIComponent(r.model + "@@" + r.condition.slug)}">${esc(r.model)}</a></td>
      <td class="small" title="${esc(r.condition.slug)}">${esc(condMode(r.condition))}</td>
      ${runCell(r)}
    </tr>`).join("")}</tbody></table>`;
}

// Grouped: rows grouped per model so you can compare its settings side by side.
function lbGrouped(runs) {
  const byModel = new Map();
  for (const r of runs) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model).push(r);
  }
  const groups = [...byModel.entries()].map(([model, rs]) => {
    rs.sort((a, b) => b.summary.puzzle_elo - a.summary.puzzle_elo);
    return { model, rs, best: rs[0].summary.puzzle_elo };
  }).sort((a, b) => b.best - a.best);

  return `<table class="lb">${lbHead}<tbody>
    ${groups.map(({ model, rs }, i) => rs.map((r, j) => `<tr class="${j === 0 ? "grp" : ""}">
        ${j === 0 ? `<td rowspan="${rs.length}">${i + 1}</td>
          <td rowspan="${rs.length}"><a href="#/model/${encodeURIComponent(r.model + "@@" + r.condition.slug)}">${esc(model)}</a></td>` : ""}
        <td class="small"><a href="#/model/${encodeURIComponent(r.model + "@@" + r.condition.slug)}" title="${esc(r.condition.slug)}">${esc(condMode(r.condition))}</a></td>
        ${runCell(r)}
      </tr>`).join("")).join("")}</tbody></table>`;
}

function renderLeaderboard() {
  const runs = state.runs;
  app().innerHTML = `<h1>Puzzle leaderboard</h1>
    <p class="muted">MLE puzzle-Elo on frozen suites. Every model solves the identical set.
      <span class="pill">${runs.length} runs · ${state.puzzleIndex.size} puzzles</span></p>
    <div class="filterbar">
      <span class="muted small">View</span>
      <label class="seg"><input type="radio" name="lbview" value="flat" ${lbView === "flat" ? "checked" : ""}> Ranking</label>
      <label class="seg"><input type="radio" name="lbview" value="grouped" ${lbView === "grouped" ? "checked" : ""}> Compare settings</label>
    </div>
    ${lbView === "grouped" ? lbGrouped(runs) : lbFlat(runs)}
    <p><a href="#/puzzles">Browse puzzles &amp; solve them yourself →</a></p>`;

  for (const el of document.querySelectorAll('input[name="lbview"]')) {
    el.addEventListener("change", (e) => { lbView = e.target.value; renderLeaderboard(); });
  }
}

function catRollup(items) {
  const acc = {};
  for (const it of items) {
    for (const [dim, vals] of Object.entries(it.categories || {})) {
      for (const v of vals) {
        const k = `${dim}:${v}`;
        acc[k] = acc[k] || { n: 0, solved: 0 };
        acc[k].n++; acc[k].solved += it.solved ? 1 : 0;
      }
    }
  }
  return Object.entries(acc).filter(([, x]) => x.n >= 2).sort((a, b) => b[1].n - a[1].n);
}

// Solve rate by difficulty tier, easiest → hardest.
function tierRollup(items) {
  const acc = {};
  for (const it of items) {
    const t = (it.categories?.tier || [])[0];
    if (!t) continue;
    acc[t] = acc[t] || { n: 0, solved: 0 };
    acc[t].n++; acc[t].solved += it.solved ? 1 : 0;
  }
  return TIER_ORDER.filter((t) => acc[t]).map((t) => [t, acc[t]]);
}

function renderModel(key) {
  const [model, slug] = key.split("@@");
  const run = state.runs.find((r) => r.model === model && (!slug || r.condition.slug === slug))
    || state.runs.find((r) => r.model === model);
  if (!run) return (app().innerHTML = `<p>Unknown model. <a href="#/">back</a></p>`);
  const s = run.summary;
  const cats = catRollup(run.items);
  const tiers = tierRollup(run.items);
  const dims = [...new Set(cats.map(([k]) => k.split(":")[0]))];
  app().innerHTML = `<p><a href="#/">← leaderboard</a></p>
    <h1>${esc(model)}</h1>
    <p class="mono small">${esc(condMode(run.condition))} · ${esc(run.condition.slug)} · suite ${esc(run.suite?.name || "—")} · ${esc(run.created)}</p>
    <div class="cards">
      <div class="card"><div class="big">${s.puzzle_elo.toFixed(0)}</div><div>puzzle-Elo</div></div>
      <div class="card"><div class="big">${pct(s.solve_rate)}</div><div>solved (${s.solved}/${s.n})</div></div>
      <div class="card"><div class="big">${pct(s.first_move_legal_rate)}</div><div>first-move legal</div></div>
      <div class="card"><div class="big">${pct(s.mean_score)}</div><div>mean score</div></div>
    </div>
    <h2>Elo after each puzzle</h2>
    <div class="legend"><span class="dot ok"></span> solved <span class="dot no"></span> failed · each dot is one puzzle, easy → hard</div>
    ${eloChart(run.items)}
    ${tiers.length ? `<h2>By difficulty tier</h2>
    <table class="lb"><thead><tr><th>tier</th><th class="r">solved</th><th class="r">n</th></tr></thead><tbody>
    ${tiers.map(([t, x]) => `<tr><td>${esc(t)}</td><td class="r">${pct(x.solved / x.n)}</td><td class="r">${x.n}</td></tr>`).join("")}
    </tbody></table>` : ""}
    <h2>By category</h2>
    <div class="filterbar">
      <span class="muted small">Dimension</span>
      <select id="mf-dim"><option value="">All</option>${dims.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("")}</select>
    </div>
    <table class="lb"><thead><tr><th>category</th><th class="r">solved</th><th class="r">n</th></tr></thead>
    <tbody id="mf-body"></tbody></table>`;

  const body = document.getElementById("mf-body");
  const dimEl = document.getElementById("mf-dim");
  const renderCats = () => {
    const d = dimEl.value;
    const rows = d ? cats.filter(([k]) => k.split(":")[0] === d) : cats;
    body.innerHTML = rows.map(([k, x]) => `<tr><td>${esc(k)}</td><td class="r">${pct(x.solved / x.n)}</td><td class="r">${x.n}</td></tr>`).join("")
      || `<tr><td colspan="3" class="muted">No categories.</td></tr>`;
  };
  dimEl.addEventListener("change", renderCats);
  renderCats();
}

function renderPuzzles() {
  const rows = [...state.puzzleIndex.entries()].map(([id, e]) => {
    const solved = e.answers.filter((a) => a.item.solved).length;
    return {
      id, solved, total: e.answers.length,
      rating: e.position.rating,
      tier: (e.position.categories?.tier || [])[0] || "",
      themes: e.position.themes || [],
    };
  }).sort((a, b) => a.rating - b.rating);

  const tierSet = new Set(rows.map((r) => r.tier).filter(Boolean));
  const tierOpts = TIER_ORDER.filter((t) => tierSet.has(t));
  const themeUnion = [...new Set(rows.flatMap((r) => r.themes))].sort();

  app().innerHTML = `<p><a href="#/">← leaderboard</a></p><h1>Puzzles (${rows.length})</h1>
    <p class="muted">Ordered easy → hard. Click one to solve it and see how the models did.</p>
    <div class="filterbar">
      <input id="pf-search" type="search" placeholder="Search id or theme…" />
      <select id="pf-tier"><option value="">All tiers</option>${tierOpts.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select>
      <select id="pf-theme"><option value="">All themes</option>${themeUnion.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select>
      <span id="pf-count" class="muted small"></span>
    </div>
    <table class="lb"><thead><tr><th>id</th><th class="r">rating</th><th>tier</th><th>themes</th><th class="r">models solved</th></tr></thead>
    <tbody id="pf-body"></tbody></table>`;

  const body = document.getElementById("pf-body");
  const countEl = document.getElementById("pf-count");
  const searchEl = document.getElementById("pf-search");
  const tierEl = document.getElementById("pf-tier");
  const themeEl = document.getElementById("pf-theme");

  const apply = () => {
    const q = searchEl.value.trim().toLowerCase();
    const tier = tierEl.value, theme = themeEl.value;
    const filtered = rows.filter((r) => {
      if (tier && r.tier !== tier) return false;
      if (theme && !r.themes.includes(theme)) return false;
      if (q && !(r.id + " " + r.themes.join(" ")).toLowerCase().includes(q)) return false;
      return true;
    });
    countEl.textContent = `${filtered.length} of ${rows.length}`;
    body.innerHTML = filtered.map(({ id, rating, tier, themes, solved, total }) => `<tr class="click" onclick="location.hash='#/puzzle/${encodeURIComponent(id)}'">
      <td class="mono">${esc(id)}</td><td class="r">${rating}</td>
      <td>${esc(tier)}</td>
      <td class="small">${esc(themes.slice(0, 3).join(", "))}</td>
      <td class="r">${solved}/${total}</td></tr>`).join("")
      || `<tr><td colspan="5" class="muted">No puzzles match.</td></tr>`;
  };
  searchEl.addEventListener("input", apply);
  tierEl.addEventListener("change", apply);
  themeEl.addEventListener("change", apply);
  apply();
}

function renderPuzzle(id) {
  const e = state.puzzleIndex.get(id);
  if (!e) return (app().innerHTML = `<p>Unknown puzzle. <a href="#/puzzles">back</a></p>`);
  const p = e.position;
  app().innerHTML = `<p><a href="#/puzzles">← puzzles</a></p>
    <h1>Puzzle ${esc(id)} <span class="muted">· ${p.rating} · ${esc((p.categories?.tier || [])[0] || "")}</span></h1>
    <div class="puzzlewrap">
      <div><div id="board"></div>
        <p class="muted small">${p.solver_is_white ? "White" : "Black"} to move${p.setup_san ? ` (after ${esc(p.setup_san)})` : ""}.
        Click a piece then its destination.</p>
        <div id="verdict" class="verdict"></div>
        <button id="reveal">Reveal solution</button>
        ${p.game_url ? `<a class="small" href="${esc(p.game_url)}" target="_blank" rel="noopener">source game ↗</a>` : ""}
      </div>
      <div class="rail"><h2>How the models did</h2>${modelRail(e)}</div>
    </div>`;

  const boardEl = document.getElementById("board");
  const verdict = document.getElementById("verdict");
  const first = (p.solution || [])[0];
  renderBoard(boardEl, p.fen, {
    flip: !p.solver_is_white, interactive: true, size: 380,
    onMove: (uci) => {
      const ok = first && (uci === first || first.startsWith(uci));
      verdict.className = "verdict " + (ok ? "good" : "bad");
      verdict.textContent = ok ? `✓ Correct — ${uci} is the move.` : `✗ ${uci} is not the solution. Try again.`;
      if (ok) renderBoard(boardEl, p.fen, { flip: !p.solver_is_white, size: 380, lastMove: first });
    },
  });
  document.getElementById("reveal").onclick = () => {
    verdict.className = "verdict"; verdict.textContent = `Solution: ${(p.solution || []).join(" ")}`;
    if (first) renderBoard(boardEl, p.fen, { flip: !p.solver_is_white, size: 380, lastMove: first });
  };
}

function modelRail(e) {
  return e.answers.sort((a, b) => (b.item.solved ? 1 : 0) - (a.item.solved ? 1 : 0)).map((a) => {
    const it = a.item;
    const badge = it.solved ? `<span class="tag ok">solved</span>`
      : it.score > 0 ? `<span class="tag part">partial ${pct(it.score)}</span>`
      : it.first_move_legal ? `<span class="tag warn">legal, wrong</span>`
      : `<span class="tag bad">illegal</span>`;
    return `<div class="answer">
      <div><a href="#/model/${encodeURIComponent(a.model + "@@" + a.condition)}">${esc(a.model)}</a> ${badge}
        <span class="mono small">${esc(it.answer_move || "—")}</span></div>
      ${it.answer_explanation ? `<div class="why">“${esc(it.answer_explanation)}”</div>` : ""}
    </div>`;
  }).join("");
}

// ---- tournament views ----

// game-Elo cell: rating with ±half-CI when bounded, "*" for the anchor, else "n/a".
function ratingCell(s, anchorLabels) {
  const r = typeof s.rating === "number" ? s.rating.toFixed(0) : "—";
  const [lo, hi] = s.rating_ci || [];
  if (s.bounded && typeof lo === "number" && typeof hi === "number") {
    return `${r} <span class="ci">±${((hi - lo) / 2).toFixed(0)}</span>`;
  }
  if (anchorLabels.has(s.label)) return `${r}<span class="ci" title="fixed anchor rating">*</span>`;
  return `${r} <span class="ci">n/a</span>`;
}

async function renderGames() {
  app().innerHTML = `<h1>Tournaments</h1><p class="muted">Loading…</p>`;
  const idx = await fetchTournamentIndex();
  if (!idx || !Array.isArray(idx.tournaments) || idx.tournaments.length === 0) {
    app().innerHTML = `<h1>Tournaments</h1>
      <p class="muted">No tournaments yet. Run a round-robin and export to see games here.</p>`;
    return;
  }
  const rows = idx.tournaments.slice().sort((a, b) => String(b.created).localeCompare(String(a.created)));
  app().innerHTML = `<h1>Tournaments</h1>
    <p class="muted">Round-robin play between engines/models. Open one for standings, crosstable, and replayable games.</p>
    <table class="lb"><thead><tr><th>created</th><th class="r">players</th><th class="r">games</th><th>winner</th></tr></thead>
    <tbody>${rows.map((t) => `<tr class="click" onclick="location.hash='#/tournament/${encodeURIComponent(t.file)}'">
      <td class="mono small">${esc(fmtWhen(t.created))}</td>
      <td class="r">${esc(t.n_players)}</td>
      <td class="r">${esc(t.n_games)}</td>
      <td>${esc(t.winner || "—")}</td>
    </tr>`).join("")}</tbody></table>`;
}

async function renderTournament(file) {
  const back = `<p><a href="#/games">← tournaments</a></p>`;
  app().innerHTML = `${back}<h1>Tournament</h1><p class="muted">Loading…</p>`;
  let t;
  try { t = await fetchTournament(file); }
  catch (e) { app().innerHTML = `${back}<p class="bad">Could not load tournament <code>${esc(file)}</code>.<br>${esc(e)}</p>`; return; }

  const anchorLabels = new Set(Object.keys(t.anchor || {}));
  const standings = (t.standings || []).slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.rating || 0) - (a.rating || 0));
  const players = standings.map((s) => s.label);
  const ct = new Map();
  for (const c of t.crosstable || []) ct.set(c.a + "\u0000" + c.b, c);

  const standingsTable = `<table class="lb"><thead><tr>
      <th>#</th><th>player</th><th class="r">game-Elo</th><th class="r">W-D-L</th>
      <th class="r">score</th><th class="r">forfeits</th></tr></thead><tbody>
    ${standings.map((s, i) => `<tr>
      <td>${i + 1}</td>
      <td>${esc(s.label)}${anchorLabels.has(s.label) ? ` <span class="pill">anchor</span>` : ""}</td>
      <td class="r">${ratingCell(s, anchorLabels)}</td>
      <td class="r">${s.wins}-${s.draws}-${s.losses}</td>
      <td class="r" title="${(+s.score || 0)} / ${s.games} points">${pct((s.score || 0) / Math.max(1, s.games))}</td>
      <td class="r">${s.illegal_forfeits || 0}</td>
    </tr>`).join("")}</tbody></table>`;

  const crosstable = players.length ? `<div class="tablescroll"><table class="lb crosstable"><thead><tr><th></th>
      ${players.map((p) => `<th title="${esc(p)}">${esc(p)}</th>`).join("")}</tr></thead><tbody>
    ${players.map((rp) => `<tr><td class="rowhead">${esc(rp)}</td>
      ${players.map((cp) => {
        if (rp === cp) return `<td class="diag">·</td>`;
        const c = ct.get(rp + "\u0000" + cp);
        if (!c) return `<td class="muted">·</td>`;
        return `<td title="${esc(rp)} vs ${esc(cp)}">${c.w}-${c.d}-${c.l}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="muted small">Cells read as row-player results vs column-player: wins-draws-losses.</p>` : "";

  const gamesTable = `<table class="lb"><thead><tr>
      <th class="r">#</th><th>white</th><th>black</th><th>result</th><th>termination</th><th class="r">plies</th></tr></thead><tbody>
    ${(t.games || []).map((g, i) => `<tr class="click" onclick="location.hash='#/game/${encodeURIComponent(file)}/${i}'">
      <td class="r">${i + 1}</td>
      <td>${esc(g.white)}</td>
      <td>${esc(g.black)}</td>
      <td class="mono">${esc(g.result)}</td>
      <td class="small">${esc(g.termination || "—")}</td>
      <td class="r">${esc(g.plies)}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="muted">No games.</td></tr>`}</tbody></table>`;

  app().innerHTML = `${back}
    <h1>Tournament <span class="muted">· ${players.length} players</span></h1>
    <p class="mono small">${esc(condMode(t.condition))} · ${esc(t.condition?.slug || "—")} · max ${esc(t.max_plies)} plies · ${esc(fmtWhen(t.created))}</p>
    <h2>Standings</h2>${standingsTable}
    ${crosstable ? `<h2>Crosstable</h2>${crosstable}` : ""}
    <h2>Games</h2>${gamesTable}`;
}

// eval bar (white's perspective centipawns; ±≥9000 treated as mate).
function evalBar(cp) {
  if (cp == null) return `<div class="small muted">no eval</div>`;
  const mate = Math.abs(cp) >= 9000;
  const frac = 0.5 + Math.max(-1, Math.min(1, cp / 1000)) / 2; // white's share, 0..1
  const txt = mate ? (cp > 0 ? "#" : "-#") : (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
  return `<div class="evalrow">
    <div class="evalbar" title="advantage (white share)"><div class="evalfill" style="width:${(frac * 100).toFixed(1)}%"></div></div>
    <span class="mono small">${esc(txt)}</span> <span class="muted small">eval (white)</span></div>`;
}

async function renderGame(file, idxStr) {
  const back = `<p><a href="#/tournament/${encodeURIComponent(file)}">← tournament</a></p>`;
  const idx = parseInt(idxStr, 10);
  app().innerHTML = `${back}<h1>Game</h1><p class="muted">Loading…</p>`;
  let t;
  try { t = await fetchTournament(file); }
  catch (e) { app().innerHTML = `${back}<p class="bad">Could not load game.<br>${esc(e)}</p>`; return; }
  const g = (t.games || [])[idx];
  if (!g) { app().innerHTML = `${back}<p class="bad">No such game.</p>`; return; }

  const moves = g.moves || [];
  const fens = buildFens(moves, g.start_fen);
  let cur = 0;

  app().innerHTML = `${back}
    <h1>${esc(g.white)} <span class="muted">vs</span> ${esc(g.black)} <span class="muted">· ${esc(g.result)}</span></h1>
    <p class="mono small">${esc(g.termination || "")} · ${esc(g.plies)} plies</p>
    <div class="replaywrap">
      <div>
        <div id="gboard"></div>
        <div class="replay-controls">
          <button id="rc-first">« First</button>
          <button id="rc-prev">‹ Prev</button>
          <button id="rc-next">Next ›</button>
          <button id="rc-last">Last »</button>
        </div>
        <div id="moveinfo" class="moveinfo"></div>
        <a class="small" id="pgndl" download="${esc(String(file).replace(/\.json$/, ""))}-game${idx + 1}.pgn">download PGN ↓</a>
      </div>
      <div class="replay-side">
        <h2>Moves</h2>
        <div id="movelist" class="movelist"></div>
      </div>
    </div>`;

  const boardEl = document.getElementById("gboard");
  const infoEl = document.getElementById("moveinfo");
  const listEl = document.getElementById("movelist");
  const dl = document.getElementById("pgndl");
  if (g.pgn) dl.href = "data:application/x-chess-pgn;charset=utf-8," + encodeURIComponent(g.pgn);
  else dl.style.display = "none";

  listEl.innerHTML = moves.map((m, i) => {
    const num = m.color === "white" ? `<span class="mvnum">${Math.ceil(m.ply / 2)}.</span>` : "";
    return `${num}<span class="mv${m.forfeited ? " forf" : ""}" data-cur="${i + 1}">${esc(m.san || "?")}</span>`;
  }).join(" ") || `<span class="muted">No moves.</span>`;
  for (const el of listEl.querySelectorAll(".mv")) {
    el.addEventListener("click", () => { cur = +el.dataset.cur; update(); });
  }

  const btn = (id) => document.getElementById(id);
  function update() {
    cur = Math.max(0, Math.min(moves.length, cur));
    const last = cur > 0 ? (moves[cur - 1].uci || "").slice(0, 4) : null;
    renderBoard(boardEl, fens[cur], { size: 380, lastMove: last && last.length === 4 ? last : undefined });

    if (cur === 0) {
      infoEl.innerHTML = `<span class="muted">Start position. Step through with the controls (or ← → keys).</span>`;
    } else {
      const m = moves[cur - 1];
      const no = Math.ceil(m.ply / 2);
      const flags = [];
      if (m.forfeited) flags.push(`<span class="tag bad">forfeited</span>`);
      const bad = m.illegal_attempts || 0;
      if (m.first_attempt_legal === false || bad > 0) {
        flags.push(`<span class="tag warn">${bad} illegal ${bad === 1 ? "attempt" : "attempts"}</span>`);
      } else if (!m.forfeited) {
        flags.push(`<span class="tag ok">legal first try</span>`);
      }
      infoEl.innerHTML = `<div class="mvhdr"><b>${no}${m.color === "white" ? "." : "…"} ${esc(m.san || "?")}</b>
        <span class="mono small muted">${esc(m.uci || "")}</span> ${flags.join(" ")}</div>
        ${evalBar(m.eval_cp)}`;
    }
    for (const el of listEl.querySelectorAll(".mv")) el.classList.toggle("cur", +el.dataset.cur === cur);
    const curEl = listEl.querySelector(".mv.cur");
    if (curEl) curEl.scrollIntoView({ block: "nearest" });
    btn("rc-first").disabled = btn("rc-prev").disabled = cur === 0;
    btn("rc-next").disabled = btn("rc-last").disabled = cur === moves.length;
  }
  btn("rc-first").onclick = () => { cur = 0; update(); };
  btn("rc-prev").onclick = () => { cur -= 1; update(); };
  btn("rc-next").onclick = () => { cur += 1; update(); };
  btn("rc-last").onclick = () => { cur = moves.length; update(); };
  gameNav = { first: btn("rc-first").onclick, prev: btn("rc-prev").onclick, next: btn("rc-next").onclick, last: btn("rc-last").onclick };
  update();
}

// keyboard stepping, active only while a game replay is mounted
let gameNav = null;
window.addEventListener("keydown", (e) => {
  if (!gameNav) return;
  if (e.key === "ArrowRight") { gameNav.next(); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { gameNav.prev(); e.preventDefault(); }
  else if (e.key === "Home") { gameNav.first(); e.preventDefault(); }
  else if (e.key === "End") { gameNav.last(); e.preventDefault(); }
});

function router() {
  const parts = (location.hash.slice(1) || "/").split("/");
  const route = parts[1] || "";
  gameNav = null; // leaving any game view disables keyboard stepping
  if (route === "model") return renderModel(decodeURIComponent(parts[2] || ""));
  if (route === "puzzles") return renderPuzzles();
  if (route === "puzzle") return renderPuzzle(decodeURIComponent(parts[2] || ""));
  if (route === "games") return renderGames();
  if (route === "tournament") return renderTournament(decodeURIComponent(parts[2] || ""));
  if (route === "game") return renderGame(decodeURIComponent(parts[2] || ""), parts[3] || "0");
  return renderLeaderboard();
}

window.addEventListener("hashchange", router);
loadData().then(router).catch((e) => {
  app().innerHTML = `<p class="bad">Failed to load data. Generate runs then <code>python -m chessbench export</code>.<br>${esc(e)}</p>`;
});
