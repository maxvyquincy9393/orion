/**
 * @file wizard-prompter.ts
 * @description WizardPrompter abstraction + @clack/prompts implementation for EDITH's
 * interactive setup wizard. Mirrors openclaw's wizard/prompts.ts + wizard/clack-prompter.ts
 * pattern so the wizard logic is fully decoupled from the I/O layer (testable via mocks).
 *
 * ARCHITECTURE / INTEGRATION:
 *   Used exclusively by src/cli/onboard.ts. Provides a thin interface over @clack/prompts
 *   so every prompt is consistent, cancellable, and ANSI-styled.
 *
 * PAPER BASIS: none — UI/UX engineering pattern.
 */

import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts"
import chalk from "chalk"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single selectable option in a wizard select/multiselect prompt. */
export type WizardSelectOption<T extends string = string> = {
  value: T
  label: string
  hint?: string
}

export type WizardSelectParams<T extends string = string> = {
  message: string
  options: ReadonlyArray<WizardSelectOption<T>>
  initialValue?: T
}

export type WizardMultiSelectParams<T extends string = string> = {
  message: string
  options: ReadonlyArray<WizardSelectOption<T>>
  initialValues?: T[]
}

export type WizardTextParams = {
  message: string
  initialValue?: string
  placeholder?: string
  validate?: (value: string) => string | undefined
}

export type WizardConfirmParams = {
  message: string
  initialValue?: boolean
}

/** Handle returned by {@link WizardPrompter.progress}. */
export type WizardProgress = {
  update: (message: string) => void
  stop: (message?: string) => void
}

/**
 * Interface over all interactive I/O for the setup wizard.
 * Swap the implementation to create test mocks or remote wizard sessions.
 */
export type WizardPrompter = {
  intro: (title: string) => Promise<void>
  outro: (message: string) => Promise<void>
  note: (message: string, title?: string) => Promise<void>
  select: <T extends string>(params: WizardSelectParams<T>) => Promise<T>
  multiselect: <T extends string>(params: WizardMultiSelectParams<T>) => Promise<T[]>
  text: (params: WizardTextParams) => Promise<string>
  confirm: (params: WizardConfirmParams) => Promise<boolean>
  progress: (label: string) => WizardProgress
}

/** Thrown when the user presses Ctrl+C / cancels the wizard. */
export class WizardCancelledError extends Error {
  constructor(message = "wizard cancelled") {
    super(message)
    this.name = "WizardCancelledError"
  }
}

// ---------------------------------------------------------------------------
// Clack implementation
// ---------------------------------------------------------------------------

/**
 * Wraps a clack return value: if the user cancelled, throw WizardCancelledError.
 */
function guardCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel(chalk.yellow("Setup cancelled."))
    throw new WizardCancelledError()
  }
  return value
}

/**
 * Creates a WizardPrompter backed by @clack/prompts.
 * This is the production/interactive implementation.
 */
export function createClackPrompter(): WizardPrompter {
  // Re-cast clack functions with a concrete signature that avoids their
  // deferred conditional Option<T> type (TypeScript cannot resolve
  // `T extends Primitive ? ...` for unconstrained generic T at call sites).
  type ClackOpt<T extends string> = { value: T; label: string; hint?: string }
  const clackSelect = select as <T extends string>(opts: {
    message: string
    options: ClackOpt<T>[]
    initialValue?: T
  }) => Promise<T | symbol>
  const clackMultiselect = multiselect as <T extends string>(opts: {
    message: string
    options: ClackOpt<T>[]
    initialValues?: T[]
    required?: boolean
  }) => Promise<T[] | symbol>

  return {
    intro: async (title) => {
      intro(chalk.cyan(title))
    },

    outro: async (message) => {
      outro(chalk.cyan(message))
    },

    note: async (message, title) => {
      note(message, title ? chalk.bold(title) : undefined)
    },

    select: async <T extends string>(params: WizardSelectParams<T>) => {
      const result = await clackSelect({
        message: chalk.bold(params.message),
        options: params.options.map((opt) => ({
          value: opt.value,
          label: opt.label,
          ...(opt.hint ? { hint: chalk.gray(opt.hint) } : {}),
        })),
        initialValue: params.initialValue,
      })
      return guardCancel(result)
    },

    multiselect: async <T extends string>(params: WizardMultiSelectParams<T>) => {
      const result = await clackMultiselect({
        message: chalk.bold(params.message),
        options: params.options.map((opt) => ({
          value: opt.value,
          label: opt.label,
          ...(opt.hint ? { hint: chalk.gray(opt.hint) } : {}),
        })),
        initialValues: params.initialValues,
        required: false,
      })
      return guardCancel(result)
    },

    text: async (params) => {
      const result = await text({
        message: chalk.bold(params.message),
        initialValue: params.initialValue,
        placeholder: params.placeholder ? chalk.gray(params.placeholder) : undefined,
        validate: params.validate ? (v) => params.validate!(v ?? "") : undefined,
      })
      return guardCancel(result)
    },

    confirm: async (params) => {
      const result = await confirm({
        message: chalk.bold(params.message),
        initialValue: params.initialValue,
      })
      return guardCancel(result)
    },

    progress: (label) => {
      const s = spinner()
      s.start(label)
      return {
        update: (message) => s.message(message),
        stop: (message) => s.stop(message),
      }
    },
  }
}
