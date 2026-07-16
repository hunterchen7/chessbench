import { AlertTriangle, ExternalLink, FileCode2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { PromptCatalog } from "@/components/PromptCatalog"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"

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

export function Methodology() {
  return (
    <div className="space-y-10">
      <header className="max-w-4xl">
        <Badge variant="outline">Protocol v5 · deep-coach ablation</Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">A points-first, tool-free chess evaluation</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Every run pins the puzzle suite, prompt condition, conversation policy, provider model identifier,
          reasoning setting, output-limit policy, and sampling settings. Those fields form the identity of a result.
          By default ChessBench omits <span className="font-mono text-sm text-foreground">max_tokens</span> and records
          the provider/model limit; a numeric completion cap is used only for an explicit output-budget ablation.
        </p>
      </header>

      <section className="space-y-4">
        <div><h2 className="text-xl font-semibold">Four prompt methods</h2><p className="mt-1 text-sm text-muted-foreground">Board information and coaching depth are independent from how conversation state is handled.</p></div>
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
            <p>The canonical public Standard v3 suite executes puzzles from lowest to highest source rating, with puzzle ID as the deterministic tie-breaker. This makes the failure frontier visible in trajectory charts. Historical v2 runs retain their original ID-sorted order and content hash.</p>
            <p>For tactical puzzles, a secondary performance rating is fitted from complete solves against the source puzzle ratings and shown with a 95% confidence interval. Points remain the official ranking score; this rating is a diagnostic and is not directly comparable to human over-the-board Elo.</p>
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
