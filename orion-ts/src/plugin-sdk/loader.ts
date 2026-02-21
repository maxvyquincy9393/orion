import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { createLogger } from "../logger.js"
import { hookRegistry } from "../hooks/registry.js"
import type { OrionPlugin } from "./types.js"

const log = createLogger("plugin.loader")

export class PluginLoader {
  private readonly plugins = new Map<string, OrionPlugin>()
  private readonly pluginDir = ".orion/plugins"

  async load(source: string): Promise<OrionPlugin> {
    const resolved = path.isAbsolute(source) ? source : path.resolve(process.cwd(), source)
    const moduleUrl = pathToFileURL(resolved).toString()
    const imported = await import(moduleUrl)
    const plugin = (imported.default ?? imported.plugin ?? imported) as OrionPlugin

    if (!plugin || typeof plugin !== "object" || !plugin.name || !plugin.version) {
      throw new Error(`Invalid plugin module: ${source}`)
    }

    if (plugin.hooks) {
      for (const hook of plugin.hooks) {
        hookRegistry.register(hook)
      }
    }

    if (plugin.onLoad) {
      await plugin.onLoad()
    }

    this.plugins.set(plugin.name, plugin)
    log.info("Plugin loaded", { name: plugin.name, version: plugin.version })

    return plugin
  }

  async loadAllFromDefaultDir(): Promise<void> {
    const resolvedDir = path.resolve(process.cwd(), this.pluginDir)

    try {
      await fs.mkdir(resolvedDir, { recursive: true })
      const entries = await fs.readdir(resolvedDir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const indexPath = path.join(resolvedDir, entry.name, "index.js")
          await this.tryLoad(indexPath)
          continue
        }

        if (entry.isFile() && /\.(mjs|js|cjs)$/i.test(entry.name)) {
          await this.tryLoad(path.join(resolvedDir, entry.name))
        }
      }
    } catch (error) {
      log.warn("Failed to scan plugin directory", { dir: resolvedDir, error })
    }
  }

  private async tryLoad(source: string): Promise<void> {
    try {
      await this.load(source)
    } catch (error) {
      log.warn("Plugin load skipped", { source, error })
    }
  }

  async unload(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin) {
      return
    }

    if (plugin.hooks) {
      for (const hook of plugin.hooks) {
        hookRegistry.unregister(hook.name)
      }
    }

    if (plugin.onUnload) {
      await plugin.onUnload()
    }

    this.plugins.delete(name)
    log.info("Plugin unloaded", { name })
  }

  list(): OrionPlugin[] {
    return Array.from(this.plugins.values())
  }
}

export const pluginLoader = new PluginLoader()
