// Dependency-free SVG chessboard: render from FEN, click source->target to
// propose a UCI move. No chess engine needed — the caller grades a proposed move
// against the puzzle's known solution (same as we grade LLMs).

const GLYPH = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};
const FILES = "abcdefgh";

export function parseFen(fen) {
  const rows = fen.split(" ")[0].split("/");
  const grid = {}; // square name -> piece char
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { file += +ch; continue; }
      const sq = FILES[file] + (8 - r);
      grid[sq] = ch;
      file++;
    }
  }
  const turn = fen.split(" ")[1] || "w";
  return { grid, turn };
}

// Render into `el`. opts: { flip, onMove(uci), highlight:[squares], lastMove:'e2e4', interactive }
export function renderBoard(el, fen, opts = {}) {
  const { grid } = parseFen(fen);
  const flip = !!opts.flip;
  const size = opts.size || 360;
  const s = size / 8;
  const state = { from: null };
  const highlight = new Set(opts.highlight || []);
  const last = opts.lastMove ? [opts.lastMove.slice(0, 2), opts.lastMove.slice(2, 4)] : [];

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.classList.add("board");

  function sqAt(rank, file) { return FILES[file] + (rank + 1); }

  function draw() {
    svg.innerHTML = "";
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const name = sqAt(rank, file);
        const x = (flip ? 7 - file : file) * s;
        const y = (flip ? rank : 7 - rank) * s;
        const light = (rank + file) % 2 === 1;
        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", x); rect.setAttribute("y", y);
        rect.setAttribute("width", s); rect.setAttribute("height", s);
        rect.setAttribute("class", "sq " + (light ? "light" : "dark") +
          (highlight.has(name) ? " hl" : "") + (last.includes(name) ? " last" : "") +
          (state.from === name ? " sel" : ""));
        rect.dataset.sq = name;
        svg.appendChild(rect);
        const piece = grid[name];
        if (piece) {
          const t = document.createElementNS(svgNS, "text");
          t.setAttribute("x", x + s / 2); t.setAttribute("y", y + s / 2);
          t.setAttribute("class", "pc " + (piece === piece.toUpperCase() ? "white" : "black"));
          t.setAttribute("text-anchor", "middle");
          t.setAttribute("dominant-baseline", "central");
          t.setAttribute("font-size", s * 0.72);
          t.textContent = GLYPH[piece];
          t.dataset.sq = name;
          svg.appendChild(t);
        }
      }
    }
  }
  draw();

  if (opts.interactive) {
    svg.addEventListener("click", (ev) => {
      const sq = ev.target?.dataset?.sq;
      if (!sq) return;
      if (!state.from) {
        if (grid[sq]) { state.from = sq; draw(); }
      } else if (state.from === sq) {
        state.from = null; draw();
      } else {
        const uci = state.from + sq;
        const chosen = state.from; state.from = null; draw();
        if (opts.onMove) opts.onMove(uci, chosen, sq);
      }
    });
  }
  el.innerHTML = "";
  el.appendChild(svg);
  return { redraw: draw };
}
