import { create } from 'zustand'

/**
 * Whether a fullscreen kiosk layer (sleep or screensaver) is covering the UI.
 * Fullscreen layers can pause expensive display work while covered.
 */
interface KioskState {
  covered: boolean
  setCovered(covered: boolean): void
}

export const useKioskState = create<KioskState>((set) => ({
  covered: false,
  setCovered: (covered) => set({ covered })
}))
