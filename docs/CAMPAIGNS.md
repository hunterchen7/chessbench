# Published campaigns

## Public low-reasoning campaign

The first headline campaign fixes both models to low reasoning, an 8,192-token
maximum output envelope, temperature 1, UCI notation, hybrid within-task
conversation state, and the provider-compatible `prompt_json_v1` response
protocol. It contains 20 independently durable cells:

| Track | Information mode | Response styles | Models | Items per cell | Evaluations |
| --- | --- | --- | ---: | ---: | ---: |
| Standard | Modes 1, 2, and 3 | move-only + JSON rationale | 2 | 325 | 3,900 |
| Woodpecker | Mode 4 full line | move-only + JSON rationale | 2 | 135 | 540 |
| Esoteric | Mode 3 coached | move-only + JSON rationale | 2 | 50 | 200 |
| **Total** |  |  |  |  | **4,640** |

The models are `openai/gpt-5.6-luna` and
`anthropic/claude-haiku-4.5`, each addressed through OpenRouter. Response style
is an orthogonal comparison; it does not create additional information modes.

Validate the frozen suite hashes and inspect all commands without making paid
calls:

```bash
python3 scripts/run_public_campaign.py --dry-run
```

Run or resume the complete campaign and publish durable progress to Cloudflare:

```bash
python3 scripts/run_public_campaign.py --sync
```

Before creating a new run row, the launcher checks the current OpenRouter key
and refuses to start below $1 remaining. This avoids empty 0/N partial cells;
use `--minimum-credits` to raise the floor. Smoke-derived extrapolation puts the
complete campaign near $40, so funding roughly $45 leaves a reasonable margin.
`--skip-credit-check` is available for an intentionally unlimited or proxied
credential whose balance endpoint is unavailable.

Every underlying cell has its own SQLite natural key. Repeating the command
skips completed cells and resumes partial cells from their first missing item.
The script stops on the first provider failure by default, rebuilds all static
JSON indexes, and optionally drains the local outbox before exiting. Use
`--continue-on-error` only when later cells should be attempted despite an
earlier provider failure.

Useful bounded launches include:

```bash
python3 scripts/run_public_campaign.py --tracks standard --models gpt-5.6-luna
python3 scripts/run_public_campaign.py --tracks woodpecker --response-styles move_only
python3 scripts/run_public_campaign.py --tracks esoteric --models claude-haiku-4.5
```

### Budget proof campaign

Before spending on the headline models, run the Standard track one durable cell
at a time with `qwen3.5-flash` at low reasoning. The initial compatibility cell
is Mode 1 / move-only:

```bash
python3 -m chessbench run-model \
  --model qwen3.5-flash \
  --suite suites/public/standard-lichess-v2.json \
  --db runs/chessbench.db \
  --out-dir web/public/data/runs \
  --mode 1 \
  --move-only \
  --response-protocol prompt_json_v1 \
  --reasoning low \
  --max-output-tokens 8192
```

After inspecting that cell, the campaign runner can resume the remaining
move-only modes in order with `--tracks standard --models qwen3.5-flash
--response-styles move_only`. Every puzzle result is committed to SQLite before
the next paid request, so the process can be interrupted after any item and
resumed without repeating completed work. Pricing is deliberately not frozen
in this document; check the provider immediately before a paid run. This model
is a harness proof model, not one of the two headline comparison models.

## Public game response-style campaign

Games use a separate six-condition matrix because the number of paid turns per
game is variable. It crosses Modes 1–3 with move-only and JSON+rationale, using
two games per condition so each model receives White once. Every game starts
from the standard initial position, uses separate private conversations, hybrid
within-game context, low reasoning, and the same 8,192-token output identity.

```bash
python3 scripts/run_public_game_campaign.py --dry-run
python3 scripts/run_public_game_campaign.py --publish
```

The three rationale conditions already published under the original filenames
are recognized by the same natural keys and replay to Cloudflare without paid
calls. The launcher therefore spends only on missing/partial conditions, most
notably the three move-only matches. A Cloudflare interruption is recovered by
rerunning `--publish`; the local game ledger is replayed before any new move.
