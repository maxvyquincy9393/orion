/**
 * @file browser-types.ts
 * @description Shared types for the browser automation layer.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Extracted to break the circular import between src/agents/tools/browser.ts
 *   (which exports BrowserInteractableElement / BrowserObservation AND uses
 *   smart-form-filler.ts via dynamic import) and src/browser/smart-form-filler.ts
 *   (which previously imported those types back from browser.ts).
 *
 *   Both modules import from here; neither imports from the other for types.
 */

/** An interactive HTML element captured during a browser page observation. */
export interface BrowserInteractableElement {
  id: string
  tag: string
  text: string
  role: string
  ariaLabel: string
  placeholder: string
  href: string
  isVisible: boolean
}

/** A snapshot of the current browser page state. */
export interface BrowserObservation {
  title: string
  url: string
  content: string
  elements: BrowserInteractableElement[]
  timestamp: number
}
