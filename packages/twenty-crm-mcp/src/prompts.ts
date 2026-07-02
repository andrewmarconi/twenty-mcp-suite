import * as clack from "@clack/prompts";
import type { Option } from "@clack/prompts";

export interface PromptAPI {
  intro(msg: string): void;
  outro(msg: string): void;
  note(msg: string, title?: string): void;
  text(opts: {
    message: string;
    placeholder?: string;
    initialValue?: string;
    validate?: (v: string) => string | undefined;
  }): Promise<string | symbol>;
  select<T extends string>(opts: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValue?: T;
  }): Promise<T | symbol>;
  confirm(opts: { message: string }): Promise<boolean | symbol>;
  isCancel(value: unknown): value is symbol;
}

export function clackPrompts(): PromptAPI {
  return {
    intro: (msg) => clack.intro(msg),
    outro: (msg) => clack.outro(msg),
    note: (msg, title) => clack.note(msg, title),
    text: (opts) =>
      clack.text({
        ...opts,
        validate: opts.validate ? (v) => opts.validate!(v ?? "") : undefined,
      }),
    select: <T extends string>(opts: {
      message: string;
      options: Array<{ value: T; label: string; hint?: string }>;
      initialValue?: T;
    }) =>
      clack.select<T>({
        ...opts,
        options: opts.options as Option<T>[],
      }),
    confirm: (opts) => clack.confirm(opts),
    isCancel: (value): value is symbol => clack.isCancel(value),
  };
}
