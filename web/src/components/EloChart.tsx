import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

export interface EloPoint {
  index: number
  seq_elo: number
  rating: number
  solved: boolean
  puzzle_id: string
}

/** Sequential puzzle-Elo trajectory: how a model's running rating moved puzzle by puzzle. */
export function EloChart({ points, final }: { points: EloPoint[]; final?: number }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={points} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="index" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
        <YAxis
          stroke="var(--muted-foreground)"
          fontSize={12}
          tickLine={false}
          domain={["dataMin - 100", "dataMax + 100"]}
          width={48}
        />
        <Tooltip
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--popover-foreground)",
          }}
          formatter={(v) => [Math.round(Number(v)), "Elo"]}
          labelFormatter={(i) => `Puzzle ${i}`}
        />
        {final !== undefined && (
          <ReferenceLine y={final} stroke="var(--chart-2)" strokeDasharray="4 4" />
        )}
        <Line
          type="monotone"
          dataKey="seq_elo"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
