import type { VisionAnalysis } from "@stylelens/contracts";

/** 轻量类型：后端只做结构校验，Vision shape 由 workspace contract 统一维护。 */

export interface LightFact {
  property: string;
  value: string;
  source: string;
  confidence?: number;
  targetUid?: string;
}

export interface LightSubtreeNode {
  uid: string;
  parentUid?: string;
  childIndex?: number;
  depth?: number;
  tagName: string;
  roleGuess: string;
  semanticRole?: string;
  interactive?: boolean;
  visibilityState?: "visible" | "opacity-zero";
  effectiveOpacity?: number;
  actionHint?: string;
  state?: {
    disabled?: boolean;
    expanded?: boolean;
    selected?: boolean;
    checked?: boolean;
    pressed?: boolean;
    indeterminate?: boolean;
    current?: string;
  };
  attributes?: Record<string, string>;
  control?: {
    kind: string;
    type?: string;
    placeholder?: string;
    title?: string;
    valuePresent?: boolean;
  };
  rect?: { x: number; y: number; width: number; height: number };
  computed?: Record<string, string>;
  layout?: string;
  background?: string;
  color?: string;
  border?: string;
  radius?: string;
  shadow?: string;
  typography?: { fontSize: string; fontWeight: string; lineHeight: string };
  pseudoElements?: Array<{
    pseudo: string;
    content?: string;
    display: string;
    size?: { width: number; height: number };
    inferredPurpose?: string;
  }>;
  textContent?: string;
  children: LightSubtreeNode[];
}

export interface LightPageContext {
  pageBackground?: string;
  scheme: "dark" | "light" | "unknown";
  palette: Array<{ hex: string; count: number; usage: string }>;
}

export interface LightProfile {
  version: string;
  analysisScope?: "element" | "component";
  target: {
    uid: string;
    selectedUid?: string;
    tagName: string;
    role?: string;
    classes?: string[];
    attributes?: Record<string, string>;
    rect?: {
      x: number;
      y: number;
      width: number;
      height: number;
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };
    textContent?: string;
    insideIframe?: boolean;
    isShadowBoundary?: boolean;
  };
  context: {
    componentBoundary?: {
      kind: string;
      confidence: number;
      evidence: string[];
      rootUid?: string;
      rootTagName?: string;
      rootClasses?: string[];
    };
    outerLayoutContext?: string[];
    ancestors?: Array<{ tagName: string; classes: string[] }>;
  };
  layout: {
    display?: string;
    position?: string;
    flex?: unknown;
    grid?: unknown;
    semanticDescription?: string;
  };
  spacing?: {
    margin?: Record<string, string>;
    padding?: Record<string, string>;
    gap?: string;
    boxSizing?: string;
    renderedSize?: { width: number; height: number };
  };
  typography: {
    fontFamily?: string;
    fontFamilySource?: string;
    fontSize?: string;
    fontWeight?: string;
    lineHeight?: string;
    letterSpacing?: string;
    textAlign?: string;
    semanticRole?: string;
  };
  visual: {
    color?: { observed: string; normalized: string; token?: string };
    background?: {
      kind: string;
      color?: { observed: string; normalized: string; token?: string };
      gradient?: string;
      semanticDescription?: string;
    };
    border?: {
      width: string;
      style: string;
      color?: { observed: string; normalized?: string };
      sides?: Record<
        string,
        {
          width: string;
          style: string;
          color?: { observed: string; normalized?: string };
        }
      >;
    };
    radius?: {
      summary?: string;
      topLeft?: string;
      topRight?: string;
      bottomRight?: string;
      bottomLeft?: string;
    };
    shadows?: Array<{
      offsetX: string;
      offsetY: string;
      blur: string;
      spread: string;
      color: unknown;
      semanticDescription?: string;
    }>;
    transform?: string;
    transformOrigin?: string;
    clipPath?: string;
    maskImage?: string;
    mixBlendMode?: string;
    isolation?: string;
    backdropFilter?: string;
    filter?: string;
  };
  assets?: Array<{
    description?: string;
    kind: string;
    width?: number;
    height?: number;
    hasUrl?: boolean;
  }>;
  responsive?: {
    viewport?: { width: number; height: number };
    devicePixelRatio?: number;
    colorScheme?: string;
    matchedMediaQueries?: string[];
    rootFontSize?: string;
    themeSummary?: string;
  };
  states?: Array<{ state: string; captured: boolean }>;
  visionEvidence?: {
    source: "vision" | "delegate";
    analysis: VisionAnalysis;
  };
  componentTree?: LightSubtreeNode[];
  pageContext?: LightPageContext;
  facts: LightFact[];
  inferences: Array<{
    type: string;
    conclusion: string;
    confidence: number;
    reason: string[];
  }>;
  warnings: Array<{ code: string; message: string; severity: string }>;
  matchedRules?: Array<{
    selector: string;
    stylesheetUrl?: string;
    media?: string;
    properties: Record<string, string>;
    accessible: boolean;
  }>;
  cssVariables?: Array<{
    name: string;
    resolvedValue: string;
    sourceElement?: string;
    sourceRule?: string;
    scope?: string;
  }>;
}
