import { z } from 'zod'

const postHosts = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'])
const shortHosts = new Set(['vt.tiktok.com', 'vm.tiktok.com'])
const postPath = /^\/@[\w.-]+\/video\/(\d+)\/?$/
const maxPageBytes = 2 * 1024 * 1024
const maxCaptionLength = 8000

export function parseTikTokVideoUrl(raw: string): URL | null {
  const url = URL.parse(raw)
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port) return null
  if (postHosts.has(url.hostname)) {
    if (postPath.test(url.pathname) || /^\/t\/[\w-]+\/?$/.test(url.pathname)) {
      return new URL(url.pathname, 'https://www.tiktok.com')
    }
  }
  if (shortHosts.has(url.hostname) && /^\/[\w-]+\/?$/.test(url.pathname)) {
    return new URL(url.pathname, url.origin)
  }
  return null
}

const postData = z.object({
  __DEFAULT_SCOPE__: z.object({
    'webapp.video-detail': z.object({
      itemInfo: z.object({ itemStruct: z.object({ id: z.string(), desc: z.string() }) }),
    }),
  }),
})

export async function fetchTikTokCaption(source: string, signal: AbortSignal): Promise<string | undefined> {
  let url = parseTikTokVideoUrl(source)
  if (!url) return

  const options: RequestInit = {
    redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
    headers: { Accept: 'text/html' },
  }
  try {
    let response = await fetch(url, options)
    if (!postPath.test(url.pathname)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (response.status < 300 || response.status >= 400 || !location) return
      const destination = URL.parse(location, url)
      url = destination && parseTikTokVideoUrl(destination.href)
      if (!url || !postPath.test(url.pathname)) return
      response = await fetch(url, options)
    }
    const id = url.pathname.match(postPath)?.[1]
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel()
      return
    }

    const reader = response.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let bytes = 0
    let html = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maxPageBytes) return
        html += decoder.decode(value, { stream: true })
      }
      html += decoder.decode()
    } finally {
      await reader.cancel()
    }
    const payload = html.match(/<script\b[^>]*\sid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1]
    if (!payload) return
    const parsed = postData.safeParse(JSON.parse(payload))
    if (!parsed.success) return
    const item = parsed.data.__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct
    const caption = item.desc.trim()
    if (item.id === id && caption.length <= maxCaptionLength) return caption || undefined
  } catch {
    signal.throwIfAborted()
    // Missing post data or a lookup timeout can fall back to the other inputs.
  }
}
