/** 轻量类型：后端只做结构校验（完整 Zod schema 在 extension 侧，§55.2 解耦） */

export interface LightFact {
  property: string
  value: string
  source: string
  confidence?: number
}

export interface LightProfile {
  version: string
  target: {
    uid: string
    tagName: string
    classes?: string[]
    textContent?: string
  }
  context: {
    componentBoundary?: { kind: string; confidence: number; evidence: string[] }
    outerLayoutContext?: string[]
    ancestors?: Array<{ tagName: string; classes: string[] }>
  }
  layout: {
    display?: string
    position?: string
    flex?: unknown
    grid?: unknown
    semanticDescription?: string
  }
  spacing?: {
    margin?: Record<string, string>
    padding?: Record<string, string>
    gap?: string
    boxSizing?: string
    renderedSize?: { width: number; height: number }
  }
  typography: {
    fontFamily?: string
    fontFamilySource?: string
    fontSize?: string
    fontWeight?: string
    lineHeight?: string
    letterSpacing?: string
    textAlign?: string
    semanticRole?: string
  }
  visual: {
    color?: { observed: string; normalized: string; token?: string }
    background?: {
      kind: string
      color?: { observed: string; normalized: string; token?: string }
      gradient?: string
      semanticDescription?: string
    }
    border?: { width: string; style: string }
    radius?: { summary?: string; topLeft?: string }
    shadows?: Array<{ offsetX: string; offsetY: string; blur: string; spread: string; color: unknown; semanticDescription?: string }>
  }
  assets?: Array<{ description?: string; kind: string }>
  responsive?: {
    viewport?: { width: number; height: number }
    colorScheme?: string
    matchedMediaQueries?: string[]
    rootFontSize?: string
    themeSummary?: string
  }
  states?: Array<{ state: string; captured: boolean }>
  facts: LightFact[]
  inferences: Array<{ type: string; conclusion: string; confidence: number; reason: string[] }>
  warnings: Array<{ code: string; message: string; severity: string }>
}
