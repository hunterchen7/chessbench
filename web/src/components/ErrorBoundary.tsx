import { Component, type ReactNode } from "react"

interface State {
  error: Error | null
}

/** Keeps a render error in one page from blanking the whole app (e.g. a bad FEN reaching the board). */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-6">
          <p className="font-medium text-destructive">Something went wrong rendering this view.</p>
          <p className="mt-1 text-sm text-muted-foreground">{this.state.error.message}</p>
          <button
            className="mt-3 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
