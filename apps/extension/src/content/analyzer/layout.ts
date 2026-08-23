import type {
  FlexLayout,
  GridLayout,
  LayoutProfile,
  SpacingProfile,
} from '../../shared/schemas/style-profile'

function toJsonRect(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  return { width: r.width, height: r.height }
}

/** Flex 分析（§11） */
export function analyzeFlex(el: HTMLElement, cs: CSSStyleDeclaration): FlexLayout | undefined {
  const display = cs.display
  if (display !== 'flex' && display !== 'inline-flex') return undefined
  const items = Array.from(el.children)
    .slice(0, 8)
    .map((child) => {
      const ccs = getComputedStyle(child)
      return {
        flexGrow: Number.parseFloat(ccs.flexGrow) || 0,
        flexShrink: Number.parseFloat(ccs.flexShrink) || 1,
        flexBasis: ccs.flexBasis,
        order: Number.parseInt(ccs.order, 10) || 0,
      }
    })
  return {
    direction: cs.flexDirection,
    wrap: cs.flexWrap,
    justifyContent: cs.justifyContent,
    alignItems: cs.alignItems,
    alignContent: cs.alignContent !== 'normal' ? cs.alignContent : undefined,
    gap: cs.gap,
    items,
  }
}

/** Grid 分析（§11） */
export function analyzeGrid(el: HTMLElement, cs: CSSStyleDeclaration): GridLayout | undefined {
  if (cs.display !== 'grid' && cs.display !== 'inline-grid') return undefined
  return {
    templateColumns: cs.gridTemplateColumns,
    templateRows: cs.gridTemplateRows !== 'none' ? cs.gridTemplateRows : undefined,
    autoFlow: cs.gridAutoFlow,
    gap: cs.gap,
    alignItems: cs.alignItems,
    justifyContent: cs.justifyContent,
  }
}

/** 间距与盒模型（§12） */
export function analyzeSpacing(el: HTMLElement, cs: CSSStyleDeclaration): SpacingProfile {
  const rect = el.getBoundingClientRect()
  return {
    margin: {
      top: cs.marginTop,
      right: cs.marginRight,
      bottom: cs.marginBottom,
      left: cs.marginLeft,
    },
    padding: {
      top: cs.paddingTop,
      right: cs.paddingRight,
      bottom: cs.paddingBottom,
      left: cs.paddingLeft,
    },
    gap: cs.gap && cs.gap !== 'normal' ? cs.gap : undefined,
    boxSizing: cs.boxSizing,
    renderedSize: toJsonRect(el),
    layoutSize: { width: el.offsetWidth, height: el.offsetHeight },
  }
}

/** 布局语义描述（供 Prompt Compiler 直接使用，§11） */
export function describeLayout(
  cs: CSSStyleDeclaration,
  flex?: FlexLayout,
  grid?: GridLayout,
): string {
  if (flex) {
    const parts = [flex.direction === 'row' ? 'horizontal flex' : 'vertical flex']
    if (flex.justifyContent && flex.justifyContent !== 'normal') {
      parts.push(`${flex.justifyContent} main-axis alignment`)
    }
    if (flex.alignItems && flex.alignItems !== 'normal') {
      parts.push(`${flex.alignItems} cross-axis alignment`)
    }
    if (flex.gap && flex.gap !== '0px') parts.push(`${flex.gap} spacing between children`)
    return `The container uses a ${parts.join(' with ')}.`
  }
  if (grid) {
    return `The container uses a CSS grid with columns ${grid.templateColumns}${
      grid.gap && grid.gap !== '0px' ? ` and ${grid.gap} gutters` : ''
    }.`
  }
  const pos = cs.position !== 'static' ? `positioned ${cs.position}` : 'static'
  return `The element is ${pos} in the document flow.`
}

/** 汇总 LayoutProfile（§11 / §12） */
export function analyzeLayout(el: HTMLElement): LayoutProfile & { spacing: SpacingProfile } {
  const cs = getComputedStyle(el)
  const flex = analyzeFlex(el, cs)
  const grid = analyzeGrid(el, cs)
  return {
    display: cs.display,
    position: cs.position,
    positionContext: cs.position !== 'static' ? 'nearest positioned ancestor' : undefined,
    zIndex: cs.zIndex && cs.zIndex !== 'auto' ? Number.parseInt(cs.zIndex, 10) : undefined,
    overflow: cs.overflow,
    flex,
    grid,
    semanticDescription: describeLayout(cs, flex, grid),
    spacing: analyzeSpacing(el, cs),
  }
}
