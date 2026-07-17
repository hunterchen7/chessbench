# Frontier puzzle probes

Frontier probes are preliminary cost-and-behavior checks, not headline benchmark
scores. They use the frozen `frontier-hardest-v1` suite
(`sha256:1325fce9508b0931`), which contains the three highest-rated positions in
the active Standard suite, ordered hardest first: 3,120, 3,102, and 3,093.

Every probe uses Method 1: authoritative FEN plus explicit piece locations,
side to move, UCI answers, no legal-move list, no coaching, no requested
explanation, and no provider tools. Conversation state persists only between
solver moves inside one puzzle. Provider-visible reasoning is captured when it
is available, and the provider-native output allowance is left uncapped.

The three lines contain at most 14 solver turns in total (8 + 3 + 3). A wrong
or illegal move ends that puzzle immediately, so a run can use fewer calls.
Models are first tested at low reasoning. Medium and high are separate variants
and should be run only after the lower-effort cost and behavior are understood.

Provider routes are chosen only after checking OpenRouter's current endpoint
throughput and uptime. The exact route is part of the model variant so results
from different hosts are never silently pooled. When a newly released model has
no stable throughput history, that absence is recorded and the run proceeds one
puzzle at a time.

## Preliminary results

| Date (UTC) | Model configuration | Route | Solved | Legal first | Points | Cost | Completion / reasoning tokens | First moves (hardest first) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 2026-07-17 | GPT-5.6 Sol · low | OpenAI only | 0/3 | 3/3 | 0.00/3 | $0.165756 | 5,477 / 5,447 | `d2d5`, `f3f7`, `e4d4` |
| 2026-07-17 | GPT-5.6 Sol · high | OpenAI only | 1/3 | 3/3 | 1.00/3 | $0.480530 | 15,568 / 15,518 | `d2d5`, `d7f7`, `e4d4` |
| 2026-07-17 | Claude Fable 5 · high | Google Vertex global only | 0/3 | 3/3 | 0.33/3 | $2.626052 | 50,449 / 7,056 | `c2c1q`, `d7f7` then `f7f8`, `e4d4` |
| 2026-07-17 | Kimi K3 · high requested* | MoonshotAI INT4 only | 0/3 | 3/3 | 0.33/3 | $0.764671 | 50,322 / 50,245 | `c2c1q`, `c4f7`, `h5g6` then `e4h4` |

The GPT-5.6 Sol low run is `6cdedf64bcbd4e988a9506f6651eba2c`.
All three answers were legal first attempts but differed from the frozen
solution move. The high run is `5886eb76a3b84b65a5729e0d1533f14d`; it solved
the 3,102-rated line completely and made the same legal-but-wrong first moves as
low on the other two positions.

OpenAI exposed a reasoning-token count and encrypted `reasoning_details` blocks
for both variants, but no readable reasoning text. ChessBench stores the opaque
blocks for audit and same-puzzle continuity without presenting them as visible
thought.

The Claude Fable 5 high run is `b5039128ba454a02bcbe02ee909f7674`.
It returned readable reasoning on every puzzle, which ChessBench stores in full
alongside the exact prompts and provider payloads. On the hardest position it
focused on the advanced c-pawn and chose immediate promotion. On the middle
position it found the correct first move, `d7f7`, but then deviated with
`f7f8`, earning one-third partial credit. These snippets are useful behavioral
evidence, but are not treated as a complete or provider-hidden chain of thought.

The Kimi K3 high run is `101b63f6c2964cb7ac114a649a2573b4`.
It also returned readable reasoning, including substantially longer text than
its visible move answer. It focused on promotion in the first position, missed
the middle tactic, and found `h5g6` on the third position before deviating with
`e4h4`, again earning one-third partial credit. The earlier Kimi K3 low request
timed out before producing a durable chess answer and was not retried.

\* The run identity records the requested `high` effort exactly. OpenRouter's
current Kimi K3 model card says the upstream endpoint supports only `max`
(default) reasoning and that finer effort levels are still forthcoming. The
provider response does not expose the effective effort, so this result must not
be interpreted as a verified high-versus-max compute ablation.

These runs are too small for an ability claim; their purpose is to establish
observed cost and failure-mode baselines before a larger evaluation.

This table is intentionally append-only for completed probe variants. Partial
or provider-failed attempts remain in the durable database but are not reported
as completed results.
