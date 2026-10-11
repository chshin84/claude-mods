export type Term = { term: string; desc: string }

declare module 'claude-code' {
  interface PluginState {
    glossary: { terms: Term[]; isOn: boolean; status: string }
  }
}
