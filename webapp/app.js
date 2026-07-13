import { renderBoard } from "./board.js";

const state = { runs: [], puzzleIndex: new Map() };
const app = () => document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => (x * 100).toFixed(1) + "%";

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
function renderLeaderboard() {
  const rows = state.runs.map((r) => {
    const s = r.summary, [lo, hi] = s.puzzle_elo_ci;
    const elo = s.puzzle_elo_bounded ? `${s.puzzle_elo.toFixed(0)} <span class="ci">±${((hi - lo) / 2).toFixed(0)}</span>` : `≥${s.puzzle_elo.toFixed(0)}`;
    return { r, s, elo };
  }).sort((a, b) => b.s.puzzle_elo - a.s.puzzle_elo);

  app().innerHTML = `<h1>Puzzle leaderboard</h1>
    <p class="muted">MLE puzzle-Elo on frozen suites. Every model solves the identical set.</p>
    <table class="lb"><thead><tr><th>#</th><th>model</th><th>condition</th><th class="r">puzzle-Elo</th>
      <th class="r">solved</th><th class="r">legal</th><th class="r">n</th><th class="r">cost</th></tr></thead><tbody>
    ${rows.map(({ r, s, elo }, i) => `<tr>
      <td>${i + 1}</td>
      <td><a href="#/model/${encodeURIComponent(r.model + "@@" + r.condition.slug)}">${esc(r.model)}</a></td>
      <td class="mono small">${esc(r.condition.slug)}</td>
      <td class="r">${elo}</td>
      <td class="r">${pct(s.solve_rate)}</td>
      <td class="r">${pct(s.first_move_legal_rate)}</td>
      <td class="r">${s.n}</td>
      <td class="r small">${s.cost_usd != null ? "$" + s.cost_usd.toFixed(4) : "—"}</td>
    </tr>`).join("")}</tbody></table>
    <p><a href="#/puzzles">Browse puzzles &amp; solve them yourself →</a></p>`;
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

function renderModel(key) {
  const [model, slug] = key.split("@@");
  const run = state.runs.find((r) => r.model === model && (!slug || r.condition.slug === slug))
    || state.runs.find((r) => r.model === model);
  if (!run) return (app().innerHTML = `<p>Unknown model. <a href="#/">back</a></p>`);
  const s = run.summary;
  const cats = catRollup(run.items);
  app().innerHTML = `<p><a href="#/">← leaderboard</a></p>
    <h1>${esc(model)}</h1>
    <p class="mono small">${esc(run.condition.slug)} · suite ${esc(run.suite?.name || "—")} · ${esc(run.created)}</p>
    <div class="cards">
      <div class="card"><div class="big">${s.puzzle_elo.toFixed(0)}</div><div>puzzle-Elo</div></div>
      <div class="card"><div class="big">${pct(s.solve_rate)}</div><div>solved (${s.solved}/${s.n})</div></div>
      <div class="card"><div class="big">${pct(s.first_move_legal_rate)}</div><div>first-move legal</div></div>
      <div class="card"><div class="big">${pct(s.mean_score)}</div><div>mean score</div></div>
    </div>
    <h2>Elo after each puzzle</h2>${eloChart(run.items)}
    <h2>By category</h2>
    <table class="lb"><thead><tr><th>category</th><th class="r">solved</th><th class="r">n</th></tr></thead><tbody>
    ${cats.map(([k, x]) => `<tr><td>${esc(k)}</td><td class="r">${pct(x.solved / x.n)}</td><td class="r">${x.n}</td></tr>`).join("")}
    </tbody></table>`;
}

function renderPuzzles() {
  const rows = [...state.puzzleIndex.entries()].map(([id, e]) => {
    const solved = e.answers.filter((a) => a.item.solved).length;
    return { id, e, solved, total: e.answers.length };
  }).sort((a, b) => a.e.position.rating - b.e.position.rating);
  app().innerHTML = `<p><a href="#/">← leaderboard</a></p><h1>Puzzles (${rows.length})</h1>
    <p class="muted">Ordered easy → hard. Click one to solve it and see how the models did.</p>
    <table class="lb"><thead><tr><th>id</th><th class="r">rating</th><th>tier</th><th>themes</th><th class="r">models solved</th></tr></thead><tbody>
    ${rows.map(({ id, e, solved, total }) => `<tr class="click" onclick="location.hash='#/puzzle/${encodeURIComponent(id)}'">
      <td class="mono">${esc(id)}</td><td class="r">${e.position.rating}</td>
      <td>${esc((e.position.categories?.tier || [])[0] || "")}</td>
      <td class="small">${esc((e.position.themes || []).slice(0, 3).join(", "))}</td>
      <td class="r">${solved}/${total}</td></tr>`).join("")}</tbody></table>`;
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

function router() {
  const parts = (location.hash.slice(1) || "/").split("/");
  const route = parts[1] || "";
  if (route === "model") return renderModel(decodeURIComponent(parts[2] || ""));
  if (route === "puzzles") return renderPuzzles();
  if (route === "puzzle") return renderPuzzle(decodeURIComponent(parts[2] || ""));
  return renderLeaderboard();
}

window.addEventListener("hashchange", router);
loadData().then(router).catch((e) => {
  app().innerHTML = `<p class="bad">Failed to load data. Generate runs then <code>python -m chessbench export</code>.<br>${esc(e)}</p>`;
});
