import { ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"

export function NotFound() {
  return (
    <div className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center text-center">
      <div className="font-mono text-sm text-muted-foreground">404</div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">That position is off the board.</h1>
      <p className="mt-2 text-sm text-muted-foreground">The dashboard route does not exist or the linked artifact was removed.</p>
      <Button asChild variant="outline" className="mt-6"><Link to="/"><ArrowLeft className="size-4" /> Back to overview</Link></Button>
    </div>
  )
}
