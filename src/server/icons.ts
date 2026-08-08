const ICONIFY_API = 'https://api.iconify.design'
// Names are still constrained to Iconify's identifier grammar. This permits
// its broad public catalogue without allowing callers to choose a host or URL.
const NAME = /^[a-z0-9-]{1,64}:[a-z0-9-]{1,100}$/

export interface OnlineIconResult { name: string; label: string }
export interface OnlineIconSearchService {
  search(query: string): Promise<OnlineIconResult[]>
  import(name: string, color?: string): Promise<string>
}

export function createOnlineIconSearchService(fetchImpl: typeof fetch = fetch): OnlineIconSearchService {
  return {
    async search(query) {
      const normalized = query.trim().slice(0, 80)
      if (!normalized) return []
      const response = await fetchImpl(`${ICONIFY_API}/search?query=${encodeURIComponent(normalized)}&limit=128`, { signal: AbortSignal.timeout(8_000) })
      if (!response.ok) throw new Error('Icon search is temporarily unavailable')
      const body = await response.json() as { icons?: unknown }
      if (!Array.isArray(body.icons)) return []
      return body.icons.filter((value): value is string => typeof value === 'string' && NAME.test(value))
        .slice(0, 60).map((name) => ({ name, label: name.split(':')[1]!.replaceAll('-', ' ') }))
    },
    async import(name, color = '#E45D3F') {
      if (!NAME.test(name)) throw new Error('That icon is not available')
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('That icon colour is not available')
      const [prefix, icon] = name.split(':') as [string, string]
      const response = await fetchImpl(`${ICONIFY_API}/${prefix}/${icon}.svg`, { signal: AbortSignal.timeout(8_000) })
      const svg = await response.text()
      if (!response.ok || svg.length > 30_000 || !svg.startsWith('<svg') || /<script|<foreignObject|\son\w+\s*=|(?:href|src)\s*=\s*["']https?:/iu.test(svg)) throw new Error('That icon could not be imported safely')
      // Iconify SVGs normally use currentColor. Data URI images cannot inherit
      // CSS colour, so bake the parent-selected colour into the saved copy.
      const tinted = svg.replaceAll('currentColor', color).replaceAll('"#000"', `"${color}"`).replaceAll("'#000'", `'${color}'`)
      return `data:image/svg+xml;base64,${Buffer.from(tinted).toString('base64')}`
    }
  }
}
