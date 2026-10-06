import type { StudioApi } from './index'

declare global {
  interface Window {
    studio: StudioApi
  }
}

export {}
