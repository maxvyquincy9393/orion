import { prepareOpenWakeWordModel } from "../voice/wake-model-assets.js"

function parseArgs(argv: string[]): { modelName?: string; json: boolean } {
  let modelName: string | undefined
  let json = false

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--json") {
      json = true
      continue
    }
    if (value === "--model") {
      modelName = argv[index + 1]
      index += 1
    }
  }

  return { modelName, json }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const prepared = await prepareOpenWakeWordModel({
    modelName: args.modelName,
  })

  if (args.json) {
    console.log(JSON.stringify({ ok: true, prepared }))
    return
  }

  console.log(`Prepared ${prepared.modelName} at ${prepared.modelPath}`)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
