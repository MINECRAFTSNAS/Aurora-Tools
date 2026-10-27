/// <reference types="vite/client" />

import type { AuroraToolsApi } from '../../preload/index'

declare global {
  interface Window {
    tools: AuroraToolsApi
  }
}

export {}
