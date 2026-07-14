// Human progress persisted in localStorage. Each verified solve is one point.

const HKEY = "chessbench.human.v2"

type Store = Record<string, { solved: boolean }>

export function humanStore(): Store {
  try {
    return JSON.parse(localStorage.getItem(HKEY) || "{}")
  } catch {
    return {}
  }
}

export function humanRecord(id: string, solved: boolean) {
  const s = humanStore()
  if (s[id]?.solved) return // keep a solve; don't downgrade to a later give-up
  s[id] = { solved }
  localStorage.setItem(HKEY, JSON.stringify(s))
}
