// SPDX-License-Identifier: Apache-2.0
/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    /** Editor handle used by the browser tests and for debugging. */
    __photoai?: unknown
  }
}
