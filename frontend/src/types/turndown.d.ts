declare module 'turndown' {
  interface TurndownOptions {
    headingStyle?: 'setext' | 'atx'
    hr?: string
    bulletListMarker?: '-' | '+' | '*'
    codeBlockStyle?: 'indented' | 'fenced'
    fence?: string
    emDelimiter?: '_' | '*'
    strongDelimiter?: '__' | '**'
    linkStyle?: 'inlined' | 'referenced'
    linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut'
    preformattedCode?: boolean
  }

  class TurndownService {
    constructor(options?: TurndownOptions)
    turndown(html: string | Node): string
    addRule(key: string, rule: object): void
    keep(filter: string | string[] | ((node: Node) => boolean)): void
    remove(filter: string | string[] | ((node: Node) => boolean)): void
    use(plugin: (service: TurndownService) => void): void
    escape(str: string): string
  }

  export = TurndownService
}
