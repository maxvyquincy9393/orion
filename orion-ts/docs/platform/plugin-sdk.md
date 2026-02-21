# Plugin SDK

Files:
- `src/plugin-sdk/types.ts`
- `src/plugin-sdk/loader.ts`

## Plugin Interface
- name
- version
- description
- hooks[]
- tools{}
- onLoad()
- onUnload()

## Loader Behavior
- Default plugin dir: `.orion/plugins`.
- Loads JS modules and directory `index.js` entries.
- Registers hook contributions automatically.
- Calls plugin lifecycle callbacks.

## Runtime Safety
- Invalid plugin modules are skipped with warning logs.
- Failures in one plugin do not stop boot.

## Operational Guidance
- Keep plugin scope minimal.
- Version plugin APIs explicitly.
- Avoid privileged tool hooks unless required.
