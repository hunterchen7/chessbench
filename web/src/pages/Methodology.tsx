import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
}

const HELP = [
  ["1", "Raw", "FEN + piece locations", "The model receives the position and must generate a legal move without a candidate list."],
  ["2", "Assisted", "Raw + SAN/UCI legal moves", "The same task with every legal move supplied, isolating move choice from board-legality tracking."],
  ["3", "Coached", "Assisted + chess guidance", "Adds fixed, non-prescriptive calculation considerations covering forcing and quiet play. It is a prompt ablation, not assumed to be stronger."],
] as const

export function Methodology() {
  return (
    <div className="space-y-10">
      <header className="max-w-4xl">
        <Badge variant="outline">Protocol v2</Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">A points-first, tool-free chess evaluation</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Every run pins the puzzle suite, prompt condition, conversation policy, provider model identifier,
          reasoning budget, output cap, and sampling settings. Those fields form the identity of a result.
        </p>
      </header>

      <section className="space-y-4">
        <div><h2 className="text-xl font-semibold">Three information prompts</h2><p className="mt-1 text-sm text-muted-foreground">The information supplied is independent from how conversation state is handled.</p></div>
        <div className="grid gap-4 lg:grid-cols-3">
          {HELP.map(([n, name, tag, description]) => <Card key={n}>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Badge variant="secondary">Mode {n}</Badge>{name}</CardTitle></CardHeader>
            <CardContent><div className="mb-3 font-mono text-xs text-foreground">{tag}</div><p className="text-sm leading-relaxed text-muted-foreground">{description}</p></CardContent>
          </Card>)}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Puzzle conversation state</CardTitle></CardHeader>
          <CardContent><Prose>
            <p><span className="font-medium text-foreground">No state ever crosses puzzle boundaries.</span> Each puzzle starts a new session.</p>
            <p>For multi-move standard puzzles, the canonical policy keeps one conversation across solver moves. On every turn it also sends the authoritative current FEN, piece list, legal moves when enabled, and the line so far. This preserves continuity without trusting the model's internal board state.</p>
            <p><span className="font-mono text-foreground">fresh</span> is retained as a named ablation: each solver move is a new request with all required state reconstructed in the prompt.</p>
          </Prose></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Woodpecker is a separate track</CardTitle></CardHeader>
          <CardContent><Prose>
            <p>The model sees one position and must return the complete forced solution in a single response. There are no intermediate opponent replies and therefore no between-move conversation policy.</p>
            <p>The grader parses the full sequence and awards prefix credit only while every preceding solver move remains correct.</p>
          </Prose></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Points</CardTitle></CardHeader>
          <CardContent><Prose>
            <p>Standard, Woodpecker, and composed puzzles are worth <span className="font-mono text-foreground">1 point</span> each. A complete solution earns 1; a correct prefix of a multi-move line earns <span className="font-mono text-foreground">correct solver plies / required solver plies</span>.</p>
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
            <p>No engine, browser, code execution, retrieval, or provider tool is offered. Compatible providers receive <span className="font-mono text-foreground">tool_choice: none</span>, and a returned tool call invalidates the response.</p>
          </Prose></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Audit logs and durable progress</CardTitle></CardHeader>
          <CardContent><Prose>
            <p>Every information mode requests the same JSON response: a UCI move plus a concise model rationale. Woodpecker requests a UCI move array plus rationale. Move scoring is independent from format compliance, so a recoverable move can score even when the JSON is malformed.</p>
            <p>We store the exact system prompt where applicable, each user prompt, visible response, parsed move, model rationale, JSON-format validity, legality, provider token counts, reasoning-token count, and cost. The rationale is not presented as faithful hidden chain of thought; provider-hidden reasoning is neither requested for publication nor reconstructed.</p>
            <p>Each completed item is committed locally to SQLite and queued for idempotent Cloudflare D1 ingestion. A run can resume after interruption or exhausted credits without replaying completed items. Filtered data can be exported as JSON from the dashboard.</p>
          </Prose></CardContent>
        </Card>
      </div>
    </div>
  )
}
