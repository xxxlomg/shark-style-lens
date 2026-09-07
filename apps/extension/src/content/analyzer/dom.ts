import type {
  AnalysisWarning,
  ContextInfo,
  DOMNodeSnapshot,
  DOMNodeSummary,
} from '../../shared/schemas/style-profile'
import { sanitizeAttributes, sanitizeText } from './privacy'
import { uidFor } from './uid'

export interface DomCollection {
  domTree: DOMNodeSnapshot[]
  context: ContextInfo
  warnings: AnalysisWarning[]
}

export interface DomOptions {
  maxAncestorDepth?: number
  maxChildren?: number
  maxSiblings?: number
}

const DEFAULTS: Required<DomOptions> = {
  maxAncestorDepth: 6,
  maxChildren: 8,
  maxSiblings: 8,
}

function isInsideIframe(el: HTMLElement): boolean {
  const win = el.ownerDocument?.defaultView
  return Boolean(win && win !== window)
}

function summaryOf(el: HTMLElement): DOMNodeSummary {
  const rect = el.getBoundingClientRect()
  return {
    uid: uidFor(el),
    tagName: el.tagName.toLowerCase(),
    classes: Array.from(el.classList),
    role: el.getAttribute('role') ?? undefined,
    childCount: el.children.length,
    rect:
      rect.width === 0 && rect.height === 0
        ? undefined
        : {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
          },
  }
}

function snapshotOf(
  el: HTMLElement,
  depth: number,
  parentUid?: string,
  uid = uidFor(el),
): DOMNodeSnapshot {
  const attrs: Record<string, string> = {}
  for (const attr of el.attributes) {
    attrs[attr.name] = attr.value
  }
  return {
    uid,
    parentUid,
    tagName: el.tagName.toLowerCase(),
    role: el.getAttribute('role') ?? undefined,
    id: el.id || undefined,
    classes: Array.from(el.classList),
    attributes: sanitizeAttributes(attrs),
    textContent: el.childElementCount === 0 ? sanitizeText(el.textContent ?? '') : undefined,
    childCount: el.children.length,
    depth,
    isShadowBoundary: el.getRootNode() !== el.ownerDocument ? true : undefined,
  }
}

/**
 * DOM 采集：目标 + 有限祖先/兄弟/子元素，限深限宽，禁止全页扫描。
 */
export function collectDom(el: HTMLElement, options: DomOptions = {}): DomCollection {
  const opts = { ...DEFAULTS, ...options }
  const warnings: AnalysisWarning[] = []
  const domTree: DOMNodeSnapshot[] = []
  const ancestors: DOMNodeSummary[] = []
  const siblings: DOMNodeSummary[] = []
  const children: DOMNodeSummary[] = []

  const targetUid = uidFor(el)
  domTree.push(snapshotOf(el, 0))

  // 祖先（限深）
  let parent = el.parentElement
  let depth = -1
  while (parent && -depth <= opts.maxAncestorDepth) {
    // Register the node before its parent so generated UIDs remain stable for
    // the parentUid reference in the bounded DOM snapshot.
    const uid = uidFor(parent)
    const parentUid = parent.parentElement ? uidFor(parent.parentElement) : undefined
    domTree.push(snapshotOf(parent, depth, parentUid, uid))
    ancestors.push(summaryOf(parent))
    parent = parent.parentElement
    depth -= 1
  }
  if (parent) {
    warnings.push({
      code: 'TREE_TRUNCATED',
      message: `Ancestor collection truncated at depth ${opts.maxAncestorDepth}`,
      severity: 'info',
    })
  }

  // 兄弟（限数）
  const parentEl = el.parentElement
  if (parentEl) {
    const sibs = Array.from(parentEl.children).filter((c) => c !== el)
    sibs.slice(0, opts.maxSiblings).forEach((s) => siblings.push(summaryOf(s as HTMLElement)))
    if (sibs.length > opts.maxSiblings) {
      warnings.push({
        code: 'TREE_TRUNCATED',
        message: `Sibling collection truncated (${sibs.length} > ${opts.maxSiblings})`,
        severity: 'info',
      })
    }
  }

  // 子元素（限数）
  const kids = Array.from(el.children) as HTMLElement[]
  kids.slice(0, opts.maxChildren).forEach((child) => {
    const childUid = uidFor(child)
    domTree.push(snapshotOf(child, 1, targetUid, childUid))
    children.push(summaryOf(child))
  })
  if (kids.length > opts.maxChildren) {
    warnings.push({
      code: 'TREE_TRUNCATED',
      message: `Child collection truncated (${kids.length} > ${opts.maxChildren})`,
      severity: 'info',
    })
  }

  // iframe / shadow 边界
  if (isInsideIframe(el)) {
    warnings.push({
      code: 'IFRAME_BOUNDARY',
      message: 'Target is inside an iframe; cross-origin frame content is not analyzed',
      severity: 'warning',
    })
  }

  const context: ContextInfo = {
    outerLayoutContext: [],
    ancestors,
    siblings,
    children,
  }

  return { domTree, context, warnings }
}
