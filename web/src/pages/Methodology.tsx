import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed text-foreground">
      {children}
    </pre>
  )
}

const MODES = [
  {
    n: 1,
    name: "Raw",
    tag: "free-form legality",
    desc: "The position only — FEN and a piece list. The model must produce a legal move on its own; an illegal move is a failure. This is the honest measure of chess ability.",
    prompt: `You are a chess engine. Find the single best move.

FEN: 6k1/5ppp/8/8/8/8/5PPP/1R4K1 w - - 0 1
Pieces:
  White: Kg1 Rb1 Pf2 Pg2 Ph2
  Black: Kg8 Pf7 Pg7 Ph7
Side to move: White

Reply with your move in SAN.`,
  },
  {
    n: 2,
    name: "Assisted",
    tag: "legal moves given · default",
    desc: "Everything in Raw, plus the full list of legal moves in SAN and UCI. This removes the legality burden so the score reflects move choice, not board tracking. It is the default headline mode.",
    prompt: `…position as above…

Legal moves: Rb8+ (b1b8), Ra1 (b1a1), Rc1 (b1c1),
  Kf1 (g1f1), Kh1 (g1h1), f3 (f2f3), f4 (f2f4), …

Reply with your move in SAN.`,
  },
  {
    n: 3,
    name: "Coached",
    tag: "legal moves + tactical coaching",
    desc: "Everything in Assisted, plus a tactical checklist that primes the model to calculate forcing moves. This is the max-help mode — the molded coaching prompt was tuned by A/B-testing several variants on a fixed model.",
    prompt: `…position + legal moves as above…

This is a tactical position: there is a concrete best move.
1. List every CHECK, CAPTURE, and threat — forcing moves first.
2. Calculate the opponent's forced replies 2-3 moves deep.
3. Hunt for forks, pins, skewers, discovered attacks,
   back-rank mates, removing the defender, trapped pieces.
4. Prefer a forcing line that wins material or mates.
5. Confirm the move is legal and doesn't hang.

Reply with your move, then a brief 'why:'.`,
  },
]

export function Methodology() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Methodology</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          chessbench measures how well language models play chess along two tracks — solving rated puzzles and
          playing full games against each other — and reports results as Elo ratings on the same scale humans use.
        </p>
      </div>

      {/* Help modes */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">The three help modes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The same puzzle is scored under different amounts of scaffolding. How much you help the model changes the
            result dramatically, so every run records exactly which mode it used.
          </p>
        </div>
        <div className="rounded-md border border-chart-4/30 bg-chart-4/5 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Finding:</span> more help isn't always better. A/B-testing
          the coaching variants on a fixed model, the plain <span className="font-mono">Assisted</span> mode matched or
          beat every <span className="font-mono">Coached</span> variant — heavy scaffolding distracted the model more
          than it helped. So the headline leaderboard uses the assisted mode, and coaching is reported as its own axis
          rather than assumed to be an upgrade.
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {MODES.map((m) => (
            <Card key={m.n} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Badge variant="secondary">Mode {m.n}</Badge>
                  {m.name}
                </CardTitle>
                <Badge variant="outline" className="w-fit text-xs font-normal">
                  {m.tag}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <p className="text-sm text-muted-foreground">{m.desc}</p>
                <Mono>{m.prompt}</Mono>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Puzzle Elo</CardTitle>
          </CardHeader>
          <CardContent>
            <Prose>
              <p>
                Each puzzle carries a Lichess rating — the Elo at which a human solves it ~50% of the time. Given which
                puzzles a model solved, we fit the single rating <span className="font-mono text-foreground">R</span>{" "}
                that best explains the outcomes, using the same logistic model Lichess uses:
              </p>
              <Mono>{`P(solve | rating r) = 1 / (1 + 10^((r − R)/400))`}</Mono>
              <p>
                <span className="font-mono text-foreground">R</span> is the maximum-likelihood fit over all attempts
                (solved harder puzzles push it up; failed easy ones pull it down). A 95% confidence interval comes from
                the Fisher information. Solving none rails to <span className="font-mono">≤</span> a floor; solving
                everything rails to <span className="font-mono">≥</span> a ceiling.
              </p>
              <p>
                The <span className="text-foreground">sequential trajectory</span> on each model page replays the same
                fit puzzle-by-puzzle, easiest first — so you can watch the rating climb and stall.
              </p>
            </Prose>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Game Elo</CardTitle>
          </CardHeader>
          <CardContent>
            <Prose>
              <p>
                Models play a round-robin, both colours. Ratings come from a Bradley–Terry fit over every result (a
                draw counts as half a point), optionally anchored to a Stockfish player at a fixed Elo to put the whole
                table on an absolute scale.
              </p>
              <p>
                Games run in the assisted mode (legal moves are provided), so a result reflects chess, not whether a
                model can avoid an illegal move. If a game reaches the move cap, a Stockfish evaluation adjudicates it:
                a side that is winning by more than ~2 pawns takes the point instead of a hollow draw.
              </p>
              <p>
                When move-by-move evaluation is on, each move's centipawn swing yields a Lichess-style{" "}
                <span className="text-foreground">accuracy %</span> for the game.
              </p>
            </Prose>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Legality handling</CardTitle>
          </CardHeader>
          <CardContent>
            <Prose>
              <p>How an illegal move is treated is its own axis:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  <span className="font-mono text-foreground">free-form</span> — an illegal move is an immediate loss
                  of the puzzle / game.
                </li>
                <li>
                  <span className="font-mono text-foreground">retry</span> — the model is told its move was illegal and
                  gets a few more tries.
                </li>
                <li>
                  <span className="font-mono text-foreground">legal-list</span> — every legal move is supplied up
                  front, so illegal moves are essentially impossible.
                </li>
                <li>
                  <span className="font-mono text-foreground">otb</span> — an "over the board" framing where the{" "}
                  <span className="font-mono">N</span>th cumulative illegal move forfeits.
                </li>
              </ul>
            </Prose>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sampling &amp; caveats</CardTitle>
          </CardHeader>
          <CardContent>
            <Prose>
              <p>
                Models are sampled at their native <span className="text-foreground">temperature 1.0</span> — how
                they're actually used — rather than greedy decoding. Games self-diversify at that temperature, so no
                opening book is forced.
              </p>
              <p>
                <span className="text-foreground">Contamination</span> is the biggest validity risk: public Lichess
                puzzles may sit in training data, so a model could recall rather than calculate. A private,
                engine-generated suite exists to control for this; treat public-suite numbers as an upper bound.
              </p>
            </Prose>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
