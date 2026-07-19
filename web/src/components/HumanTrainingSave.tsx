import { useEffect, useState, type FormEvent } from "react"
import { Check, Save } from "lucide-react"
import {
  HumanTrainingSaveError,
  fetchHumanTrainingProfile,
  saveHumanTrainingProfile,
  type HumanTrainingProfile,
} from "@/lib/backend"
import type { HumanTrainingSession } from "@/lib/humanTraining"
import { formatRatingDeviation } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,23}$/

export function HumanTrainingSave({ apiBase, session }: { apiBase: string; session: HumanTrainingSession }) {
  const [profile, setProfile] = useState<HumanTrainingProfile | null>(null)
  const [handle, setHandle] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [coolingDown, setCoolingDown] = useState(false)

  useEffect(() => {
    let active = true
    void fetchHumanTrainingProfile(apiBase).then((saved) => {
      if (!active || !saved) return
      setProfile(saved)
      setHandle(saved.handle)
      setCooldownUntil(Date.parse(saved.next_save_at))
    }).catch(() => {})
    return () => { active = false }
  }, [apiBase])

  useEffect(() => {
    const remaining = cooldownUntil - Date.now()
    if (remaining <= 0) {
      setCoolingDown(false)
      return
    }
    setCoolingDown(true)
    const timer = window.setTimeout(() => setCoolingDown(false), remaining)
    return () => window.clearTimeout(timer)
  }, [cooldownUntil])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const username = handle.trim()
    setMessage(null)
    setError(null)
    if (!HANDLE_PATTERN.test(username)) {
      setError("Use 3–24 letters, numbers, underscores, or hyphens.")
      return
    }
    setSaving(true)
    try {
      const saved = await saveHumanTrainingProfile(apiBase, username, session)
      setProfile(saved)
      setHandle(saved.handle)
      setCooldownUntil(Date.parse(saved.next_save_at))
      setMessage(`Saved rating ${Math.round(saved.rating).toLocaleString()} at RD ${formatRatingDeviation(saved.rating_deviation)}.`)
    } catch (reason) {
      if (reason instanceof HumanTrainingSaveError && reason.retryAfterSeconds) {
        setCooldownUntil(Date.now() + reason.retryAfterSeconds * 1000)
      }
      setError(reason instanceof HumanTrainingSaveError && reason.status === 429
        ? "Could not save right now. Try again later."
        : reason instanceof Error ? reason.message : "Could not save this run.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="border-b bg-muted/5 px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <label htmlFor="training-username" className="sr-only">Unique public username</label>
          <Input
            id="training-username"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="Unique username"
            autoComplete="nickname"
            maxLength={24}
            aria-invalid={Boolean(error)}
          />
        </div>
        <Button type="submit" size="sm" variant={profile ? "outline" : "default"} disabled={saving || coolingDown}>
          {profile ? <Check className="size-4" /> : <Save className="size-4" />}
          {saving ? "Saving…" : coolingDown ? profile ? "Saved" : "Try again later" : profile ? "Save latest run" : "Save run"}
        </Button>
      </div>
      <div className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        {error ? <span className="text-destructive">{error}</span> : message ? <span className="text-emerald-700 dark:text-emerald-300">{message}</span> : profile ? <>Saved publicly as <span className="font-medium text-foreground">{profile.handle}</span>.</> : "Username is public and case-insensitively unique."}
      </div>
    </form>
  )
}
