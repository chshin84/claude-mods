export type Term = { term: string; desc: string; detail?: string }

declare module 'claude-code' {
  interface PluginState {
    glossary: { terms: Term[]; asked: Term[]; isOn: boolean; opened: string[] }
  }
}
