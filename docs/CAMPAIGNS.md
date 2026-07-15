# Published campaigns

## Public low-reasoning campaign

The first headline campaign fixes both models to low reasoning, an 8,192-token
maximum output envelope, temperature 1, UCI notation, hybrid within-task
conversation state, and the provider-compatible `prompt_json_v1` response
protocol. It contains 20 independently durable cells:

| Track | Information mode | Response styles | Models | Items per cell | Evaluations |
| --- | --- | --- | ---: | ---: | ---: |
| Standard | Modes 1, 2, and 3 | move-only + JSON rationale | 2 | 300 | 3,600 |
| Woodpecker | Mode 4 full line | move-only + JSON rationale | 2 | 125 | 500 |
| Esoteric | Mode 3 coached | move-only + JSON rationale | 2 | 50 | 200 |
| **Total** |  |  |  |  | **4,300** |

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
