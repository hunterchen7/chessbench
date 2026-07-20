import { AlertTriangle, ExternalLink, FileCode2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { PromptCatalog } from "@/components/PromptCatalog"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { RatedPoolDownloads } from "@/components/RatedPoolDownloads"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
}

const HELP = [
  ["1", "Raw", "FEN + piece locations", "The model receives the position and must generate a legal move without a candidate list."],
  ["2", "Assisted", "Raw + UCI legal moves", "The same task with every legal move supplied as unannotated UCI coordinates, isolating move choice from board-legality tracking."],
  ["3", "Coached", "Assisted + chess guidance", "Adds fixed, non-prescriptive calculation considerations covering forcing and quiet play. It is a prompt ablation, not assumed to be stronger."],
  ["4", "Deep coached", "Assisted + 925-word calculation framework", "Expands the coaching into explicit candidate search, strongest-defense analysis, recapture and zwischenzug checks, calculation to stability, endgame checks, and a final opponent-perspective blunder audit."],
] as const

const PROMPT_TEMPLATES = [
  {
    id: "standard",
    title: "Standard puzzle · move by move",
    body: `You are solving a chess puzzle. Choose the single best move for the side to move.

FEN: {authoritative current FEN}

Pieces:
{explicit white and black piece locations}

Side to move: {White|Black}

{Methods 2–4 only} Legal moves [UCI]: a2a3, a2a4, ...

{continuations only} Moves already played in this puzzle [UCI]: {uci moves}

{Method 3: concise coaching block}
{Method 4: versioned 925-word deep-coaching block}

{move_only: Reply with ONLY your move in UCI, no explanation or other text.}
{json_rationale: strict JSON object with a lowercase UCI move and concise rationale.}`,
  },
  {
    id: "puzzle-system",
    title: "Stateful puzzle · system message",
    body: `You are solving one chess puzzle across several turns. Keep track of the line, but trust each newly supplied position as authoritative.`,
  },
  {
    id: "game",
    title: "Game · private system and turn messages",
    body: `SYSTEM
You are playing a chess game as {White|Black}.
On each of your turns, choose a single legal move.
{optional coaching block}
{move-only or JSON UCI response contract}

USER — canonical hybrid context
{opponent's last played move on continuations}
{authoritative current FEN, piece list, side to move}
{when enabled: Legal moves [UCI]: ...}
Your move.`,
  },
  {
    id: "esoteric",
    title: "Esoteric · verifier-specific prompt",
    body: `You are solving a composed chess problem. Stipulation: {#n|s#n|r#n|h#n|...}.

{plain-language definition of the stipulation}

{authoritative position and optional UCI legal candidates}

{request a UCI key move, complete UCI line, or interactive study move according to answer shape}`,
  },
] as const

const FRONTIER_PRELIMINARY = [
  {
    model: "GPT-5.6 Sol",
    effort: "Low",
    route: "OpenAI only",
    solved: "0/3",
    legal: "3/3",
    cost: "$0.1658",
    tokens: "5,477 / 5,447",
    reasoning: "Opaque",
  },
  {
    model: "GPT-5.6 Sol",
    effort: "High",
    route: "OpenAI only",
    solved: "1/3",
    legal: "3/3",
    cost: "$0.4805",
    tokens: "15,568 / 15,518",
    reasoning: "Opaque",
  },
  {
    model: "Claude Fable 5",
    effort: "High",
    route: "Google Vertex global",
    solved: "0/3 · 0.33 pt",
    legal: "3/3",
    cost: "$2.6261",
    tokens: "50,449 / 7,056",
    reasoning: "Readable",
  },
  {
    model: "Kimi K3",
    effort: "High requested*",
    route: "MoonshotAI INT4",
    solved: "0/3 · 0.33 pt",
    legal: "3/3",
    cost: "$0.7647",
    tokens: "50,322 / 50,245",
    reasoning: "Readable",
  },
  {
    model: "GPT-5.6 Sol",
    effort: "Max",
    route: "OpenAI only",
    solved: "0/3",
    legal: "3/3",
    cost: "$3.2418",
    tokens: "109,048 / 109,017",
    reasoning: "Summaries + opaque",
  },
  {
    model: "Claude Fable 5",
    effort: "Max",
    route: "Google Vertex global",
    solved: "Provider error",
    legal: "—",
    cost: "$0 billed",
    tokens: "10 / 6,656",
    reasoning: "Readable checkpoint",
  },
  {
    model: "Kimi K3",
    effort: "Max*",
    route: "MoonshotAI INT4",
    solved: "0/3 · 0.33 pt",
    legal: "3/3",
    cost: "$1.2885",
    tokens: "83,804 / 83,727",
    reasoning: "Readable",
  },
] as const

export function Methodology() {
  return (
    <div className="space-y-10">
      <header className="max-w-4xl">
        <Badge variant="outline">Rated session v1 · adaptive Glicko-2</Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">A points-first, tool-free chess evaluation</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Every run pins the puzzle suite, prompt condition, conversation policy, provider model identifier,
          reasoning setting, output-limit policy, and sampling settings. Those fields form the identity of a result.
          By default ChessBench omits <span className="font-mono text-sm text-foreground">max_tokens</span> and records
          the provider/model limit; a numeric completion cap is used only for an explicit output-budget ablation.
        </p>
      </header>

      <section className="space-y-4">
        <div><h2 className="text-xl font-semibold">The headline rating protocol</h2><p className="mt-1 text-sm text-muted-foreground">One unassisted chess task replaces prompt-method shopping on the primary leaderboard.</p></div>
        <Card className="border-emerald-500/25 bg-emerald-500/[0.04]"><CardContent className="pt-6"><Prose>
          <p>Every model configuration starts at <span className="font-mono text-foreground">1,500</span> with RD <span className="font-mono text-foreground">500.00</span> and volatility <span className="font-mono text-foreground">0.09</span>. After each puzzle, a frozen-puzzle Glicko-2 update changes only the solver. The next unused puzzle is selected deterministically from a ±100 band around that new rating.</p>
          <p>The model receives raw FEN, explicit piece locations, and the side to move, then replies with one UCI move. It receives no legal-move list, coaching, requested rationale, puzzle rating, theme, or indication that it is being benchmarked. An illegal or wrong move ends that puzzle. Conversation state continues between moves of the same puzzle and resets before the next one.</p>
          <p>Each session stops after at least 50 puzzles once RD is at most 77.00, or at a 100-puzzle safety cap. One run is sufficient and its current estimate appears while it progresses. If additional seeded runs exist, the headline averages all available ratings and reports their between-run standard deviation; every run and its own RD remain visible.</p>
          <p>The complete path—including seed, eligible band, selected puzzle, pre/post rating state, prompts, responses, reasoning metadata, tokens, and cost—is durable and resumable. Puzzle ratings never change. Returned reasoning artifacts remain auditable, but opaque OpenAI encrypted blocks are not replayed through later tool-free chess turns; the visible move, authoritative board, and UCI history carry the conversation.</p>
        </Prose></CardContent></Card>
        <RatedPoolDownloads />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Frontier probe lab</h2>
            <p className="mt-1 text-sm text-muted-foreground">Preliminary cost and behavior checks on the three hardest active-suite positions, not headline scores.</p>
          </div>
          <Badge variant="outline">3,120 · 3,102 · 3,093</Badge>
        </div>
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Table reorderableKey="methodology-frontier-probes" className="min-w-[860px] text-left">
                <TableHeader className="bg-muted/35 text-xs text-muted-foreground">
                  <TableRow>
                    <TableHead className="px-4">Model configuration</TableHead>
                    <TableHead className="px-4">Route</TableHead>
                    <TableHead className="px-4 text-right">Outcome</TableHead>
                    <TableHead className="px-4 text-right">Legal first</TableHead>
                    <TableHead className="px-4 text-right">Cost</TableHead>
                    <TableHead className="px-4 text-right">Completion / reasoning</TableHead>
                    <TableHead className="px-4">Reasoning text</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {FRONTIER_PRELIMINARY.map((row) => (
                    <TableRow key={`${row.model}-${row.effort}-${row.route}`}>
                      <TableCell className="px-4 py-3 font-medium">{row.model} <Badge variant="secondary" className="ml-2">{row.effort}</Badge></TableCell>
                      <TableCell className="px-4 py-3 text-muted-foreground">{row.route}</TableCell>
                      <TableCell className="px-4 py-3 text-right font-mono">{row.solved}</TableCell>
                      <TableCell className="px-4 py-3 text-right font-mono">{row.legal}</TableCell>
                      <TableCell className="px-4 py-3 text-right font-mono">{row.cost}</TableCell>
                      <TableCell className="px-4 py-3 text-right font-mono text-xs">{row.tokens}</TableCell>
                      <TableCell className="px-4 py-3 text-muted-foreground">{row.reasoning}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          </CardContent>
        </Card>
        <Prose>
          <p>All probes use raw FEN plus piece locations, move-only UCI, no legal-move list, no coaching, no tools, and isolated conversation state per puzzle. The three lines require at most 14 model turns; a wrong move ends its puzzle early.</p>
          <p>Runs begin at low reasoning and move upward as separate model variants. Routes are pinned only after checking OpenRouter throughput and uptime. Newly released endpoints without stable throughput history are advanced one puzzle at a time. Detailed run IDs, moves, and token accounting live in <a className="text-emerald-700 hover:underline dark:text-emerald-300" href="https://github.com/hunterchen7/chessbench/blob/main/docs/FRONTIER_PROBES.md" target="_blank" rel="noreferrer">the frontier probe note</a>.</p>
          <p>Sol max produced no solves despite using 109,017 reasoning tokens; additional reasoning did not monotonically improve this three-item sample. Fable max is shown as a provider error, not scored as a chess loss: its first request returned no move and was not retried.</p>
          <p>* Kimi K3 records the requested effort, but its current OpenRouter card advertises only default/max reasoning. The provider did not report the effective setting for the earlier high request, so the two rows are stochastic replicates rather than a verified effort ablation.</p>
        </Prose>
      </section>

      <section className="space-y-4">
        <div><h2 className="text-xl font-semibold">Fixed-suite ablation lab</h2><p className="mt-1 text-sm text-muted-foreground">The older four-method matrix remains available to study prompt sensitivity; it no longer defines the headline rating.</p></div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {HELP.map(([n, name, tag, description]) => <Card key={n}>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Badge variant="secondary">Method {n}</Badge>{name}</CardTitle></CardHeader>
            <CardContent><div className="mb-3 font-mono text-xs text-foreground">{tag}</div><p className="text-sm leading-relaxed text-muted-foreground">{description}</p></CardContent>
          </Card>)}
        </div>
        <Card className="border-amber-500/25 bg-amber-500/[0.045]">
          <CardContent className="flex gap-3 pt-6">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <h3 className="font-semibold">Why legal candidates are UCI-only</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                SAN is not neutral metadata: <span className="font-mono text-foreground">+</span> labels a checking move and <span className="font-mono text-foreground">#</span> labels checkmate. A mate-in-one candidate such as <span className="font-mono text-foreground">Qh7#</span> therefore reveals the answer before the model calculates it. Canonical candidate lists, requested answers, and within-puzzle move history now use UCI only. The version <span className="font-mono text-foreground">uci_candidates_v1</span> is part of every condition identity, so mixed-SAN results cannot be pooled with this protocol.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <h3 className="font-semibold">How the deep coach was derived</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              The fixed text synthesizes established calculation themes: candidate moves and comparison, forcing moves without blindly preferring them, the opponent&apos;s best defensive resources, calculation through recaptures to a stable position, and a final move-safety check. The prose is original, contains no puzzle-specific hint, and is frozen as <span className="font-mono text-foreground">deep_coach_v1</span>.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
              <a className="text-emerald-700 hover:underline dark:text-emerald-300" href="https://www.newinchess.com/improve-your-chess-calculation" target="_blank" rel="noreferrer">Ramesh · calculation</a>
              <a className="text-emerald-700 hover:underline dark:text-emerald-300" href="https://www.qualitychess.co.uk/products/improvement/29/practical_chess_defence_by_jacob_aagaard/" target="_blank" rel="noreferrer">Aagaard · defense</a>
              <a className="text-emerald-700 hover:underline dark:text-emerald-300" href="https://www.newinchess.com/forcing-chess-moves-new-and-extended-4th-edition" target="_blank" rel="noreferrer">Hertan · forcing moves</a>
              <a className="text-emerald-700 hover:underline dark:text-emerald-300" href="https://www.newinchess.com/is-your-move-safe" target="_blank" rel="noreferrer">Heisman · move safety</a>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-xl font-semibold">Exact prompts and builder source</h2><p className="mt-1 text-sm text-muted-foreground">Inspect and copy the literal messages and provider schema. Every rendered run message is also retained verbatim with its puzzle.</p></div>
          <a href="https://github.com/hunterchen7/chessbench/blob/main/chessbench/conditions.py" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-300"><FileCode2 className="size-4" /> Prompt builder source <ExternalLink className="size-3.5" /></a>
        </div>
        <PromptCatalog />
        <div className="pt-2"><h3 className="font-semibold">Structural templates for other tracks</h3><p className="mt-1 text-xs text-muted-foreground">Placeholders below explain message assembly. They are not presented as literal prompts; exact Standard text is above, while game and composed-attempt pages expose their stored messages.</p></div>
        <Card>
          <CardContent className="px-5 py-1">
            <Accordion type="multiple" defaultValue={["standard"]}>
              {PROMPT_TEMPLATES.map((template) => <AccordionItem key={template.id} value={template.id}>
                <AccordionTrigger>{template.title}</AccordionTrigger>
                <AccordionContent><pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/30 p-4 text-xs leading-relaxed">{template.body}</pre></AccordionContent>
              </AccordionItem>)}
            </Accordion>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">Puzzle/game templates live in <span className="font-mono">chessbench/conditions.py</span>; stateful puzzle and game message assembly lives in <span className="font-mono">chessbench/agents.py</span>; composed stipulations live in <span className="font-mono">chessbench/tasks/composed.py</span>.</p>
      </section>

      <section className="space-y-4">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold">Response style is a separate axis</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Each of the four methods can independently request a bare move or structured JSON with a visible rationale, producing an eight-cell Standard matrix.
          </p>
        </div>
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="hidden grid-cols-[180px_1fr_1fr] border-b bg-muted/35 text-xs font-semibold sm:grid">
              <div className="p-3 text-muted-foreground">Board information</div>
              <div className="border-l p-3"><ResponseStyleBadge condition="plain-text-v1" /></div>
              <div className="border-l p-3"><ResponseStyleBadge condition="json-rationale" /></div>
            </div>
            {HELP.map(([n, name]) => (
              <div key={n} className="grid border-b last:border-b-0 sm:grid-cols-[180px_1fr_1fr]">
                <div className="bg-muted/20 p-3"><div className="text-xs font-semibold">Method {n} · {name}</div><div className="mt-1 text-[11px] text-muted-foreground">prompt axis</div></div>
                <div className="border-t p-3 sm:border-l sm:border-t-0"><div className="sm:hidden"><ResponseStyleBadge condition="plain-text-v1" compact /></div><div className="mt-1 font-mono text-xs">plain_text_v1</div><p className="mt-1 text-xs text-muted-foreground">Move or line only; no explanation requested.</p></div>
                <div className="border-t p-3 sm:border-l sm:border-t-0"><div className="sm:hidden"><ResponseStyleBadge condition="json-rationale" compact /></div><div className="mt-1 font-mono text-xs">json_rationale</div><p className="mt-1 text-xs text-muted-foreground">Structured move plus concise visible rationale.</p></div>
              </div>
            ))}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">Comparisons hold suite, model variant, mode, context, and sampling constant; only response style changes.</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Puzzle conversation state</CardTitle></CardHeader>
          <CardContent><Prose>
            <p><span className="font-medium text-foreground">No state ever crosses puzzle boundaries.</span> Each puzzle starts a new session.</p>
            <p>For multi-move standard puzzles, the canonical policy keeps one conversation across solver moves. On every turn it also sends the authoritative current FEN, piece list, UCI legal moves when enabled, and the UCI line so far. This preserves continuity without trusting the model's internal board state.</p>
            <p>Native reasoning continuity is enabled by default. When a provider returns signed or encrypted reasoning blocks, the exact structured artifact—not the numeric token count—is preserved for the next move inside that puzzle. Readable reasoning text is retained for audit; opaque state is never presented as readable thought.</p>
            <p><span className="font-mono text-foreground">fresh</span> is retained as a named ablation: each solver move is a new request with all required state reconstructed in the prompt.</p>
          </Prose></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Points</CardTitle></CardHeader>
          <CardContent><Prose>
            <p>Standard and composed puzzles are worth <span className="font-mono text-foreground">1 point</span> each. A complete solution earns 1; a correct prefix of a multi-move line earns <span className="font-mono text-foreground">correct solver plies / required solver plies</span>.</p>
            <p>Fixed suites execute puzzles from lowest to highest source rating, with puzzle ID as the deterministic tie-breaker. They remain controlled ablations: every participant sees the identical positions in the identical order.</p>
            <p>The primary leaderboard instead reports the solver&apos;s adaptive Glicko-2 state against frozen puzzle opponents. Complete solves are wins; misses are losses. It starts at 1,500/RD 500.00 and displays the changing 95% interval at every step. Partial-line credit remains diagnostic and never becomes a draw.</p>
            <p>For tactical puzzles, a secondary Bayesian Puzzle Elo is fitted from complete solves against the source puzzle ratings. The frozen estimator uses the ordinary Elo solve-probability curve with a weak Gaussian prior of <span className="font-mono text-foreground">1,500 ± 700</span>. This prevents early all-solve or all-miss prefixes from becoming infinite; the dashboard always pairs the estimate with its rating deviation and 95% posterior interval.</p>
            <p>The Bayesian Puzzle Elo estimator is retained only for fixed-suite analysis. A fixed run is provisional while that 95% interval is wider than 400 rating points. Neither rating should be presented as human over-the-board Elo.</p>
            <p>Games use ordinary match points: win = 1, draw = 0.5, loss = 0. Leaderboards do not convert performance to Elo.</p>
          </Prose></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Game sessions and illegality</CardTitle></CardHeader>
          <CardContent><Prose>
            <p>The canonical game policy is <span className="font-mono text-foreground">hybrid</span>: one growing chat per game plus an authoritative position and move history on every turn. Sessions reset between games.</p>
            <p>Legality is independently configurable: immediate forfeit, feedback-and-retry, supplied legal list, or an over-the-board cumulative illegal-move limit. The selected policy is visible with every result.</p>
          </Prose></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Model variants and no tools</CardTitle></CardHeader>
          <CardContent><Prose>
            <p>A base model at different reasoning efforts or exact reasoning-token budgets is treated as a distinct model variant. Output-token caps are part of that identity too.</p>
            <p>The model sees a neutral chess task. Model-facing text never says benchmark, evaluation, experiment, leaderboard, or score.</p>
            <p>No engine, browser, code execution, retrieval, or provider tool is offered. Requests omit <span className="font-mono text-foreground">tools</span>, <span className="font-mono text-foreground">plugins</span>, and <span className="font-mono text-foreground">tool_choice</span>, so there is nothing the model can invoke. A returned tool call invalidates the response.</p>
          </Prose></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Audit logs and durable progress</CardTitle></CardHeader>
          <CardContent><Prose>
            <p><span className="font-mono text-foreground">move_only</span> uses <span className="font-mono text-foreground">plain_text_v1</span>; <span className="font-mono text-foreground">json_rationale</span> requests a structured UCI move plus concise visible rationale. Move scoring remains independent from format compliance.</p>
            <p>We store the exact system prompt where applicable, each user prompt, visible response, parsed move, response protocol, format validity, legality, provider token counts, reasoning-token count, cost, readable provider reasoning, and every provider-native reasoning block returned. A requested rationale remains ordinary visible output and is not presented as faithful hidden chain of thought.</p>
            <p>The dashboard keeps readable reasoning inside a collapsed disclosure. Signed, encrypted, or otherwise opaque continuity blocks remain in the scoped JSON export but are shown only as artifact metadata. Structured native blocks are replayed exactly inside the same private session; plaintext reasoning is a compatibility fallback, and token counts are never replayed. A visible-history-only run is available as an explicit ablation.</p>
            <p><span className="font-mono text-foreground">prompt_prefix_v1</span> permits provider-side reuse of exact prompt-prefix computation inside a multi-turn puzzle or private game session. It never caches an answer. Puzzle message lists still reset and receive distinct opaque routing keys; White and Black remain separate. Cache reads, writes, uncached prompt tokens, discounts, and raw usage are recorded. Composed tasks skip explicit cache writes.</p>
            <p>Each completed item is committed locally to SQLite and queued for idempotent Cloudflare D1 ingestion. A run can resume after interruption or exhausted credits without replaying completed items. Filtered data can be exported as JSON from the dashboard.</p>
          </Prose></CardContent>
        </Card>
      </div>
    </div>
  )
}
