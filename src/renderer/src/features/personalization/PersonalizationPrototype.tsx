import { useEffect, useState } from 'react'

type ThemeId = 'family' | 'minecraft' | 'frozen' | 'kpop'

const THEMES: Array<{ id: ThemeId; name: string; person: string; description: string; icon: string }> = [
  { id: 'family', name: 'Family', person: 'Everyone', description: 'Warm OpenSkyLight', icon: '⌂' },
  { id: 'minecraft', name: 'Minecraft', person: 'Ava', description: 'Blocks and bright green', icon: '▦' },
  { id: 'frozen', name: 'Frozen', person: 'Mia', description: 'Snow and icy blue', icon: '❄' },
  { id: 'kpop', name: 'KPop Demon Hunters', person: 'Leo', description: 'Neon stage energy', icon: '✦' }
]

const DISPLAY_DURATION_MS = 3_000

/**
 * PE01 interaction study. This component only exists behind the development
 * query flag in App; later tickets replace its fixture state with typed APIs.
 */
export function PersonalizationPrototype() {
  const [theme, setTheme] = useState<ThemeId>('family')
  const [reducedMotion, setReducedMotion] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const selected = THEMES.find((candidate) => candidate.id === theme)!

  useEffect(() => {
    if (!celebrating) return
    const timer = window.setTimeout(() => setCelebrating(false), DISPLAY_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [celebrating])

  const selectTheme = (next: ThemeId) => {
    setTheme(next)
    setCelebrating(false)
  }

  return (
    <div className="personalization-prototype min-h-full" data-prototype-theme={theme} data-reduced-motion={reducedMotion || undefined}>
      <div className="prototype-sky" aria-hidden="true" />
      <header className="prototype-header">
        <div>
          <p className="prototype-eyebrow">OpenSkyLight · personalization study</p>
          <h1>{theme === 'family' ? 'Family view' : `${selected.person}'s view`}</h1>
        </div>
        <div className="prototype-header-actions">
          <button type="button" className="prototype-motion" aria-pressed={reducedMotion} onClick={() => setReducedMotion((current) => !current)}>
            {reducedMotion ? 'Reduced motion on' : 'Reduce motion'}
          </button>
          <button type="button" className="prototype-complete" onClick={() => setCelebrating(true)}>
            Complete feed cat +2 ★
          </button>
        </div>
      </header>

      <main className="prototype-layout">
        <section className="prototype-dashboard" aria-label="Kiosk dashboard prototype">
          <nav className="prototype-people" aria-label="Viewing context">
            {THEMES.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={theme === candidate.id}
                aria-label={candidate.id === 'family' ? 'Show Family view' : `Show ${candidate.name}'s view`}
                className="prototype-person"
                onClick={() => selectTheme(candidate.id)}
              >
                <span className="prototype-avatar" aria-hidden="true">{candidate.icon}</span>
                <span>{candidate.name}</span>
              </button>
            ))}
          </nav>

          <section className="prototype-today" aria-labelledby="prototype-today-title">
            <div>
              <p className="prototype-eyebrow">Tuesday, 8 August</p>
              <h2 id="prototype-today-title">A calm day, {selected.person === 'Everyone' ? 'together' : selected.person}</h2>
              <p>{theme === 'family' ? 'Everyone’s plans and shared jobs remain easy to scan.' : 'The same familiar dashboard, dressed for one person.'}</p>
            </div>
            <div className="prototype-weather" aria-label="Sunny and 22 degrees"><span>☀</span> 22°</div>
          </section>

          <div className="prototype-grid">
            <article className="prototype-card prototype-card-wide"><p className="prototype-eyebrow">Up next</p><h3>After-school plans</h3><div className="prototype-event"><span>3:30</span><strong>{theme === 'family' ? 'Ava · Minecraft club' : 'Minecraft club'}</strong></div><div className="prototype-event"><span>5:00</span><strong>{theme === 'family' ? 'Leo · Dance class' : 'A snack and a quiet reset'}</strong></div></article>
            <article className="prototype-card"><p className="prototype-eyebrow">Stars</p><strong className="prototype-stat">{theme === 'family' ? '24' : '18'} ★</strong><p>{theme === 'family' ? 'Family total today' : 'Ready for a reward'}</p></article>
            <article className="prototype-card"><p className="prototype-eyebrow">Jobs today</p><h3>Feed the cat</h3><button type="button" className="prototype-job" onClick={() => setCelebrating(true)}>Tap to complete <span>+2 ★</span></button></article>
            <article className="prototype-card"><p className="prototype-eyebrow">Dinner</p><h3>Build-your-own tacos</h3><p>Everyone picks a favourite topping.</p></article>
          </div>
        </section>

        <aside className="prototype-phone" aria-label="Parent phone personalization prototype">
          <p className="prototype-eyebrow">Parent phone · Personalize Ava</p>
          <h2>Make it feel like hers</h2>
          <section className="prototype-phone-section" aria-labelledby="prototype-theme-gallery">
            <div className="prototype-section-heading"><h3 id="prototype-theme-gallery">Choose a theme</h3><span>Preview</span></div>
            <div className="prototype-theme-gallery">
              {THEMES.slice(1).map((candidate) => (
                <button key={candidate.id} type="button" aria-pressed={theme === candidate.id} onClick={() => selectTheme(candidate.id)} className={`prototype-theme-card prototype-theme-${candidate.id}`}>
                  <span aria-hidden="true">{candidate.icon}</span><strong>{candidate.name}</strong><small>{candidate.description}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="prototype-phone-section" aria-labelledby="prototype-celebration-picker">
            <div className="prototype-section-heading"><h3 id="prototype-celebration-picker">Celebration</h3><span>2–4 seconds</span></div>
            <div className="prototype-media-row"><span className="prototype-media-thumbnail" aria-hidden="true">★</span><div><strong>{uploaded ? 'ava-victory.webp' : 'Built-in star burst'}</strong><small>{uploaded ? 'Transparent WebP · 1.2 MB' : 'Always available fallback'}</small></div></div>
            <button type="button" className="prototype-upload" onClick={() => setUploaded((current) => !current)}>{uploaded ? 'Use built-in instead' : 'Simulate uploaded WebP'}</button>
            <button type="button" className="prototype-preview-button" onClick={() => setCelebrating(true)}>Preview celebration</button>
          </section>
          <p className="prototype-phone-note">The display colour mode remains a per-screen setting. This choice follows Ava to every display.</p>
        </aside>
      </main>

      {celebrating && <CelebrationPreview person={theme === 'family' ? 'Ava' : selected.person} reducedMotion={reducedMotion} onDismiss={() => setCelebrating(false)} />}
    </div>
  )
}

function CelebrationPreview({ person, reducedMotion, onDismiss }: { person: string; reducedMotion: boolean; onDismiss: () => void }) {
  return <div className="prototype-celebration" aria-atomic="true" aria-live="polite" role="status">
    <div className="prototype-safe-area" aria-hidden="true" />
    <div className={`prototype-celebration-card ${reducedMotion ? 'prototype-celebration-static' : ''}`}>
      {!reducedMotion && <div className="prototype-stars" aria-hidden="true"><i>★</i><i>✦</i><i>★</i><i>✦</i><i>★</i></div>}
      <span className="prototype-celebration-icon" aria-hidden="true">{reducedMotion ? '✓' : '★'}</span>
      <strong>{person} did it!</strong>
      <span>Feed the cat complete · +2 stars</span>
      <button type="button" onClick={onDismiss}>Dismiss preview</button>
    </div>
  </div>
}
