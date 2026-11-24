export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Size a board to the largest box that fits its stage, keeping its shape. */
export function fit(stage: HTMLElement, svg: SVGSVGElement): void {
  const box = stage.getBoundingClientRect()
  const vb = svg.viewBox.baseVal
  if (!box.width || !box.height) return
  const k = Math.min(box.width / vb.width, box.height / vb.height)
  svg.style.width = `${Math.floor(vb.width * k)}px`
  svg.style.height = `${Math.floor(vb.height * k)}px`
}

async function ask<T>(path: string, init: RequestInit): Promise<T | undefined> {
  try {
    const rsp = await fetch(path, init)
    if (!rsp.ok) return undefined
    return (await rsp.json()) as T
  } catch {
    return undefined
  }
}

export const get = <T>(path: string): Promise<T | undefined> => ask<T>(path, {headers: {Accept: 'application/json'}})

export const post = <T>(path: string, body: unknown): Promise<T | undefined> =>
  ask<T>(path, {
    method: 'POST',
    headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  })

let toastTimer = 0
export function toast(text: string): void {
  const el = $('toast')
  el.textContent = text
  el.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.remove('on'), 2600)
}
