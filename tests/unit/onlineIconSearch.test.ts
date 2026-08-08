import { describe, expect, it } from 'vitest'
import { createOnlineIconSearchService } from '../../src/server/icons'

describe('online icon search', () => {
  it('returns results from the full Iconify catalogue while rejecting malformed names', async () => {
    const service = createOnlineIconSearchService(async () => new Response(JSON.stringify({ icons: ['lucide:brush-cleaning', 'iconoir:hair-dryer', 'mdi:hair-dryer', 'material-symbols-rounded:content-cut'] })) as typeof fetch)
    await expect(service.search('hair brush')).resolves.toEqual([
      { name: 'lucide:brush-cleaning', label: 'brush cleaning' },
      { name: 'iconoir:hair-dryer', label: 'hair dryer' },
      { name: 'mdi:hair-dryer', label: 'hair dryer' },
      { name: 'material-symbols-rounded:content-cut', label: 'content cut' }
    ])
  })

  it('imports only a safe local SVG data URI', async () => {
    const service = createOnlineIconSearchService(async () => new Response('<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2" /></svg>') as typeof fetch)
    const imported = await service.import('lucide:brush-cleaning', '#2379B8')
    expect(imported).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(Buffer.from(imported.split(',')[1]!, 'base64').toString()).toContain('#2379B8')
    const unsafe = createOnlineIconSearchService(async () => new Response('<svg><script>alert(1)</script></svg>') as typeof fetch)
    await expect(unsafe.import('lucide:brush-cleaning')).rejects.toThrow('safely')
  })
})
