# Doctor CLI

File: `src/cli/doctor.ts`

## Command
`pnpm doctor`

## Checks
- Prisma DB connectivity and message count.
- LanceDB initialization.
- API key presence per provider.
- Permissions file existence.
- Python availability.
- Gateway/WebChat port availability.
- Channel configuration consistency warnings.

## Output Format
- `OK` for healthy checks.
- `WARN` for partial/missing optional config.
- `ERR` for blocking failures.

## Exit Codes
- `0` when no errors.
- `1` when at least one error.

## Usage
Run before first deploy and during incident triage.
