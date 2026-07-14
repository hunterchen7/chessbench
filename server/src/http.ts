// Small HTTP helpers: JSON responses + permissive CORS so the API can be called
// from the same-origin SPA and from a dev frontend on another port.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS,
      ...(init.headers ?? {}),
    },
  })
}

export function downloadJson(data: unknown, filename: string): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^a-z0-9_.-]/gi, "-")}"`,
      "Cache-Control": "no-store",
      ...CORS,
    },
  })
}

export function error(status: number, message: string): Response {
  return json({ error: message }, { status })
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS })
}
