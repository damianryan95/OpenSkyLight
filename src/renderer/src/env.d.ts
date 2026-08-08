/// <reference types="vite/client" />

declare global {
  interface Window {
    osl?: {
      invoke(channel: string, payload: unknown): Promise<unknown>
      on(channel: string, callback: (data: unknown) => void): () => void
    }
  }
}

export {}
