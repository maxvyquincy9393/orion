/**
 * @file registry.ts
 * @description Runtime extension registry.
 *
 * ARCHITECTURE:
 *   Global registry for all loaded extensions.
 */
import type { ExtensionManifest } from './types.js'

class ExtensionRegistry {
  private extensions = new Map<string, ExtensionManifest>()

  register(manifest: ExtensionManifest): void {
    this.extensions.set(manifest.name, manifest)
  }

  list(): ExtensionManifest[] {
    return [...this.extensions.values()]
  }

  get(name: string): ExtensionManifest | undefined {
    return this.extensions.get(name)
  }
}

export const extensionRegistry = new ExtensionRegistry()
