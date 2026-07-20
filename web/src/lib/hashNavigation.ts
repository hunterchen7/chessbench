export function hashRouteHref(path: string) {
  const base = window.location.href.split("#", 1)[0]
  const route = path.startsWith("/") ? path : `/${path}`
  return `${base}#${route}`
}

export function openHashRouteInNewTab(path: string) {
  const opened = window.open(hashRouteHref(path), "_blank")
  if (opened) opened.opener = null
}
