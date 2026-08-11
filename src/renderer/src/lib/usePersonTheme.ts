import { useEffect } from 'react'
import { personThemeInViewingContext } from '@shared/viewingContext'
import { usePeople } from '../api/hooks'
import { useUi } from '../stores/uiStore'

/** Applies a bundled personal theme only after its avatar is selected. */
export function usePersonTheme(): void {
  const viewingContext = useUi((state) => state.viewingContext)
  const { data: people } = usePeople()
  const themeId = personThemeInViewingContext(viewingContext, people ?? [])

  useEffect(() => {
    const root = document.documentElement
    if (themeId === null) root.removeAttribute('data-person-theme')
    else root.setAttribute('data-person-theme', themeId)
  }, [themeId])
}
