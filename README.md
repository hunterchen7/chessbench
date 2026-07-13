# chessbench

A chess benchmarking suite for LLMs, with two pillars:

1. **Puzzles** of varying difficulty — classic tactics today; **esoteric composed
   problems** (selfmate, helpmate, studies, retrograde/proof games) planned.
2. **Games** — LLMs playing full games against each other and a Stockfish ladder.

The **puzzle and game tracks ship now**, both verified end-to-end against real
Lichess puzzles and a real Stockfish (no API keys required to exercise them).

---

## Why this exists (the gap)

A [research sweep](#references) of the existing landscape found three disconnected worlds:

- **Bespoke chess transformers** (DeepMind [ChessBench](https://github.com/google-deepmind/searchless_chess) → 2895 Elo no-search; [Karvonen Chess-GPT](https://github.com/adamkarvonen/chess_llm_interpretability) → ~1500 Elo, 99.8% legal). These set the strength ceiling but aren't prompt-based LLMs.
- **General-LLM evals** ([ChessArena](https://arxiv.org/abs/2509.24239), [LLM Chess](https://github.com/maxim-saplin/llm_chess), [ChessQA](https://arxiv.org/pdf/2510.23948)). Frontier models are shockingly weak: **no LLM beats the ~1600-Elo Maia engine**, and puzzle accuracy collapses (o3 ~56%, GPT-4.1 & Claude-3.7 ~7%).
- **Community leaderboards** ([dubesor.de](https://dubesor.de/chess/chess-leaderboard), Lichess bots) with incompatible, non-anchored Elo.

**What none of them do — and chessbench will:**

1. **Esoteric/composed problems.** Every existing LLM bench uses only Lichess *tactical* puzzles. None test selfmate/helpmate/studies/retrograde — which stress *non-forward-search* reasoning. This is the headline differentiator.
2. **A controlled ablation matrix** over legality × representation × notation × prompting on the *same* models (prior findings are scattered and contradictory across model classes).
3. **Contamination control** (public puzzles are likely in pretraining data).
4. **An anchored, reproducible rating protocol** with error bars.

---

## Design decisions (evidence-backed)

| Question | Decision |
|---|---|
| **Legal moves: list / free-form / retry?** | Not a fixed choice — a **reported axis**. Headline = **free-form, illegal = fail** (the only condition that measures real board-state tracking; engines are 0% illegal). Also report **retry-with-feedback** (≤3 attempts) and **legal-list-provided** (skill upper bound). Always split *loss-by-illegal* from *loss-by-wrong-move*, and report per-ply legality + first-illegal-ply. |
| **Notation** | **SAN facing the model** (dominant in pretraining → better generative play), **UCI internally** for deterministic scoring. Both accepted, normalized via python-chess. |
| **Board representation** | Puzzles: **FEN + ASCII board** (hedge vs FEN tokenization brittleness). Games: **full PGN history** (state-tracking needs it). Representation is a toggleable axis. |
| **Prompting/hinting** | **Minimal default** is the headline (temp 0, no metadata). Few-shot / CoT / **coached** (an explicit "look for checks/captures/threats" checklist) / regurgitation are **reported ablation deltas, never baked in** — folding them in just measures prompt engineering. |
| **Game context (per move)** | `ContextMode` axis. **`FRESH`** (default) = self-contained prompt each turn with the authoritative board + full history; kills state-drift and is reproducible. **`GROWING`** = one conversation ("opponent played X, your move"); measures state-tracking + planning. **`HYBRID`** = growing chat but re-inject the ground-truth board each turn (best *practical* play). |
| **Esoteric verification** | **Solver-in-the-loop** (Popeye / Jacobi), never string-matching; pre-validate soundness, grade by solution-set membership. Studies scored by *achieving win/draw vs best defense* via Stockfish + Syzygy. *(planned)* |
| **Metrics** | Puzzle track: **Solved% + rating-bucketed accuracy + implied-rating curve** + first-attempt Legal%, with Wilson CIs. Game track *(planned)*: MLE-Elo vs a node-limited Stockfish ladder, Lichess Win%/Accuracy%, blunder rates, tokens/$ per move. |

Full landscape, prior-art comparison, and citations are captured in the research
that produced this design (see [References](#references)).

---

## Architecture

The engine is kept strictly separate from the model interface.

```
chessbench/
  board.py        # python-chess wrapper: strict move parse (SAN/UCI), legality, ASCII/Unicode render
  engine.py       # Stockfish: node-limited opponent + centipawn oracle
  metrics.py      # Lichess Win%/Accuracy%, blunder classes, Wilson CI, rating buckets + implied rating
  models.py       # Model interface (prompt->text): Scripted / Anthropic / OpenAI (lazy imports)
  agents.py       # Agent interface (position->move): Random / FirstLegal / Stockfish / LLMAgent
  conditions.py   # THE ABLATION AXES + prompt rendering (puzzle + game)
  puzzles.py      # Lichess puzzle load + grader (handles the Moves[0] setup-ply convention)
  games.py        # full-game loop, illegal-forfeit/retry, adjudication, match + Elo, PGN
  runner.py       # orchestration + JSONL logging
  report.py       # aggregation -> leaderboard-ready report with error bars
  __main__.py     # CLI
scripts/download_puzzles.py   # stratified sampler for the full 6M-puzzle Lichess DB
data/sample_puzzles.csv       # 500 real CC0 Lichess puzzles (ratings 399–3221) for tests/demo
tests/                        # board parsing, grading (ply-offset, mate acceptance), metrics
```

**Planned tracks** (next): `composed.py` (esoteric, Popeye/Jacobi), a round-robin
tournament + Bayeselo anchor on top of `games.py`, and an **LLM-as-UCI adapter**
so any model drops into `fastchess`/`cutechess` tournaments.

---

## Quickstart

```bash
pip install -e .            # needs python-chess; Stockfish on PATH for the oracle
pip install -e '.[dev]'     # + pytest
pip install -e '.[anthropic]'  # or '.[openai]' for LLM agents

# Baselines — no API key needed (prove the pipeline + grading):
python -m chessbench puzzles --agent random    --limit 500
python -m chessbench puzzles --agent stockfish --limit 150 --nodes 300000

# An LLM under the headline (free-form, unaided) condition:
export ANTHROPIC_API_KEY=...
python -m chessbench puzzles --agent anthropic --model claude-opus-4-8 --limit 100 --progress 10

# Sweep an ablation axis:
python -m chessbench puzzles --agent anthropic --legality legal_list --representation fen
python -m chessbench puzzles --agent anthropic --prompt-style cot --notation uci
```

Get a bigger, difficulty-balanced puzzle set (needs the `zstd` CLI):

```bash
python scripts/download_puzzles.py --per-bucket 300 --out data/puzzles_balanced.csv
python -m chessbench puzzles --data data/puzzles_balanced.csv --agent stockfish
```

### Game track

```bash
# Baseline sanity (no API key): a weak Stockfish crushes random, colors alternate.
python -m chessbench play --white stockfish --black random --games 4 --sf-skill 3

# LLM vs LLM under a chosen context mode + prompt style:
python -m chessbench play --white anthropic --black openai --games 6 \
    --context-mode fresh --prompt-style coached --legality retry --pgn-out games.pgn

# The two prompt "versions" you'd A/B: minimal vs coached; and illegal handling:
python -m chessbench play ... --prompt-style minimal --legality free_form   # instant forfeit
python -m chessbench play ... --prompt-style coached --legality retry        # retry w/ feedback
```

Illegal-move handling is the `--legality` axis (`free_form` = instant forfeit;
`retry` = up to `--retry-attempts` re-prompts that tell the model what was
illegal). Board framing is `--representation` (`fen`, `fen_ascii`, `piece_list`,
…). Cross-game memory is `--context-mode` (`fresh` / `growing` / `hybrid`).

### Verified behavior (sample fixture, 500 real puzzles)

| agent | solved | first-move legal | notes |
|---|---|---|---|
| `stockfish@300k` | **150/150 (100%)** | 100% | grader accepts correct solutions across all rating buckets & multi-move lines |
| `random` | ~0% (lucky 3% on mate-in-1) | 100% by construction | grader rejects wrong moves; low-rating floor |

Game track: `stockfish(skill 3)` beats `random` **4–0** (all checkmates, colors
alternate, 0% illegal), PGN export valid.

```
python -m pytest        # 29 passing: parsing, puzzle grading (ply-offset, retry, mate),
                        # metrics, game loop (checkmate, forfeit, cap, Elo, context modes)
```
> Note: this machine has a broken global `pytest-postgresql` plugin; run tests with
> `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest` if plugin autoload errors.

---

## Contamination warning

The bundled puzzles are public Lichess data (CC0) and are **likely present in
model pretraining** — a model may *recall* rather than *compute*. For clean
measurement, prefer post-model-cutoff positions, measure the memorization delta
on famous vs matched-difficulty fresh positions, and/or apply color-swap/mirror
perturbations that preserve the solution but break surface memorization. Treat
headline numbers on public puzzles as an upper bound.

## Roadmap

- [x] **Phase 0/1** — foundation + puzzle track
- [x] **Phase 3 (MVP)** — game track: LLM-vs-LLM / LLM-vs-engine loop, illegal-forfeit/retry, context modes, match Elo, PGN
- [ ] **Phase 2** — esoteric/composed track (Popeye/Jacobi, selfmate/helpmate first, then studies) — *the differentiator*
- [ ] **Phase 3 (full)** — round-robin tournament + Bayeselo/Glicko anchor; Stockfish Elo ladder for MLE rating; per-move centipawn/accuracy reporting
- [ ] **Phase 4** — the representation × legality × notation × context ablation study
- [ ] contamination-controlled fresh puzzle generation; LLM-as-UCI adapter; multimodal board-image track

## References

Built on `python-chess` + Stockfish. Key prior art / methodology sources:
DeepMind ChessBench (arXiv:2402.04494), Karvonen Chess-GPT (arXiv:2403.15498),
ChessArena (arXiv:2509.24239), LLM Chess (arXiv:2512.01992), ChessQA
(arXiv:2510.23948), Acher "[Debunking the Chessboard](https://blog.mathieuacher.com/GPTsChessEloRatingLegalMoves/)",
dynomight "[more chess](https://dynomight.net/more-chess/)", Toshniwal "Learning
Chess Blindfolded" (arXiv:2102.13249), and the
[Lichess accuracy formulas](https://lichess.org/page/accuracy).

License: MIT (code). Bundled puzzles: CC0 (Lichess).
