import type {
  InteractionEvidence,
  InteractionMutation,
  InteractionSnapshot,
  SubtreeState,
} from '../../shared/schemas/style-profile'
import { sanitizeAttributes, sanitizeText } from './privacy'
import { elementForUid, uidFor } from './uid'

const MAX_INTERACTION_CANDIDATES = 24
const MAX_SNAPSHOT_NODES = 384
const SAFE_NAME_RE = /menu|dropdown|select|combobox|popover|options|filter|agent|style|settings/i
const BLOCKED_NAME_RE =
  /submit|login|log\s*in|register|sign\s*in|send|delete|remove|purchase|checkout|pay|navigate|external/i

interface Candidate {
  el: HTMLElement
  event: 'click' | 'focus'
  risk: 'safe' | 'review' | 'blocked'
}

interface SnapshotNode {
  uid: string
  tagName: string
  roleGuess?:
    | 'text'
    | 'button'
    | 'icon'
    | 'input'
    | 'control'
    | 'badge'
    | 'image'
    | 'toolbar'
    | 'divider'
    | 'link'
    | 'container'
  nativeRole?: string
  accessibleName?: string
  labelledBy?: string
  controls?: string
  hasPopup?: string
  textContent?: string
  rect?: { x: number; y: number; width: number; height: number }
  visible: boolean
  state?: SubtreeState
  attributes?: Record<string, string>
}

function isVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || el.hidden) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

function nativeRoleOf(el: HTMLElement): string | undefined {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit
  const tag = el.tagName.toLowerCase()
  if (tag === 'button' || tag === 'summary') return 'button'
  if (tag === 'a' && el.hasAttribute('href')) return 'link'
  if (tag === 'select') return 'combobox'
  if (tag === 'textarea') return 'textbox'
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    if (type === 'checkbox') return 'checkbox'
    if (type === 'radio') return 'radio'
    if (type === 'range') return 'slider'
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
    return 'textbox'
  }
  if (tag === 'option') return 'option'
  if (tag === 'label') return 'label'
  return undefined
}

function roleGuessOf(el: HTMLElement): SnapshotNode['roleGuess'] {
  const tag = el.tagName.toLowerCase()
  const role = el.getAttribute('role') ?? ''
  if (
    tag === 'select' ||
    ['combobox', 'listbox', 'menuitem', 'option', 'switch', 'checkbox', 'radio'].includes(role)
  )
    return 'control'
  if (tag === 'input' || tag === 'textarea' || role === 'textbox') return 'input'
  if (tag === 'button' || role === 'button') return 'button'
  if (tag === 'a' && el.hasAttribute('href')) return 'link'
  if (tag === 'svg' || tag === 'img' || tag === 'canvas' || /icon/i.test(el.className))
    return tag === 'img' ? 'image' : 'icon'
  if (/divider|separator/i.test(el.className)) return 'divider'
  if (/toolbar|actions?|controls?/i.test(el.className)) return 'toolbar'
  if (/badge|pill|chip|tag/i.test(el.className)) return 'badge'
  if (el.childElementCount === 0 && (el.textContent ?? '').trim()) return 'text'
  return 'container'
}

function accessibleNameOf(el: HTMLElement): string | undefined {
  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel?.trim()) return sanitizeText(ariaLabel)
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
    if (text.trim()) return sanitizeText(text)
  }
  if ('labels' in el) {
    const labels = Array.from((el as HTMLInputElement).labels ?? [])
      .map((label) => label.textContent ?? '')
      .join(' ')
      .trim()
    if (labels) return sanitizeText(labels)
  }
  const alt = el.getAttribute('alt')
  if (alt?.trim()) return sanitizeText(alt)
  const title = el.getAttribute('title')
  if (title?.trim()) return sanitizeText(title)
  const text = el.textContent?.trim()
  return text ? sanitizeText(text) : undefined
}

function stateOf(el: HTMLElement): SubtreeState | undefined {
  const state: SubtreeState = {}
  if ('disabled' in el && Boolean((el as HTMLButtonElement | HTMLInputElement).disabled)) {
    state.disabled = true
  }
  if (el.getAttribute('aria-disabled') === 'true') state.disabled = true
  for (const [attribute, key] of [
    ['aria-expanded', 'expanded'],
    ['aria-selected', 'selected'],
    ['aria-checked', 'checked'],
    ['aria-pressed', 'pressed'],
  ] as const) {
    const value = el.getAttribute(attribute)
    if (value !== null) state[key] = value === 'true'
  }
  if ('checked' in el) state.checked = Boolean((el as HTMLInputElement).checked)
  if ('indeterminate' in el) state.indeterminate = Boolean((el as HTMLInputElement).indeterminate)
  if (el instanceof HTMLDetailsElement) state.expanded = el.open
  return Object.keys(state).length > 0 ? state : undefined
}

function safeAttributes(el: HTMLElement): Record<string, string> | undefined {
  const attributes = sanitizeAttributes(
    Object.fromEntries(
      Array.from(el.attributes).map((attribute) => [attribute.name, attribute.value]),
    ),
  )
  return Object.keys(attributes).length ? attributes : undefined
}

function snapshotNode(el: HTMLElement, rootRect: DOMRect): SnapshotNode | null {
  if (!isVisible(el)) return null
  const rect = el.getBoundingClientRect()
  return {
    uid: uidFor(el),
    tagName: el.tagName.toLowerCase(),
    roleGuess: roleGuessOf(el),
    nativeRole: nativeRoleOf(el),
    accessibleName: accessibleNameOf(el),
    labelledBy: el.getAttribute('aria-labelledby') ?? undefined,
    controls: el.getAttribute('aria-controls') ?? undefined,
    hasPopup: el.getAttribute('aria-haspopup') ?? undefined,
    textContent:
      el.childElementCount === 0 && el.textContent?.trim()
        ? sanitizeText(el.textContent)
        : undefined,
    rect: {
      x: rect.x - rootRect.x,
      y: rect.y - rootRect.y,
      width: rect.width,
      height: rect.height,
    },
    visible: true,
    state: stateOf(el),
    attributes: safeAttributes(el),
  }
}

function isOverlayLike(el: HTMLElement, root: HTMLElement): boolean {
  if (root.contains(el) || el === root || !isVisible(el)) return false
  const style = getComputedStyle(el)
  const role = el.getAttribute('role') ?? ''
  const className = typeof el.className === 'string' ? el.className : ''
  const positioned = style.position === 'fixed' || style.position === 'absolute'
  const elevated = style.zIndex !== 'auto' && Number.parseInt(style.zIndex, 10) > 0
  return (
    (positioned && (elevated || /menu|listbox|popover|dropdown|dialog|tooltip/i.test(className))) ||
    /menu|listbox|dialog|tooltip|popover/i.test(role) ||
    /menu|listbox|popover|dropdown|dialog|tooltip/i.test(className)
  )
}

function snapshotPriority(el: HTMLElement, root: HTMLElement, overlayRoots: HTMLElement[]): number {
  if (el === root) return 1000
  if (overlayRoots.some((overlayRoot) => overlayRoot === el || overlayRoot.contains(el))) return 900
  if (
    el.matches(
      'button, input, textarea, select, summary, a[href], [role], [aria-haspopup], [aria-expanded], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    )
  ) {
    return 800
  }
  if ((el.textContent ?? '').trim()) return 200
  return 100
}

function rectangleNearRoot(rect: DOMRect, rootRect: DOMRect): boolean {
  const horizontalGap = Math.max(rootRect.left - rect.right, rect.left - rootRect.right, 0)
  const verticalGap = Math.max(rootRect.top - rect.bottom, rect.top - rootRect.bottom, 0)
  const threshold = Math.max(320, Math.min(640, Math.max(rootRect.width, rootRect.height) * 1.5))
  return Math.hypot(horizontalGap, verticalGap) <= threshold
}

function relatedOverlayRoots(
  root: HTMLElement,
  rootRect: DOMRect,
  bodyElements: HTMLElement[],
): HTMLElement[] {
  const controlledIds = new Set(
    [root, ...Array.from(root.querySelectorAll<HTMLElement>('[aria-controls]'))]
      .flatMap((element) => (element.getAttribute('aria-controls') ?? '').split(/\s+/))
      .filter(Boolean),
  )
  const rootIds = new Set(
    [root, ...Array.from(root.querySelectorAll<HTMLElement>('[id]'))]
      .map((element) => element.id)
      .filter(Boolean),
  )
  const overlayCandidates = bodyElements.filter((node) => isOverlayLike(node, root))
  const roots = overlayCandidates.filter(
    (node) => !overlayCandidates.some((parent) => parent !== node && parent.contains(node)),
  )
  return roots.filter((node) => {
    const rect = node.getBoundingClientRect()
    const isControlled = Boolean(node.id && controlledIds.has(node.id))
    const labelsRoot = (node.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .some((id) => rootIds.has(id))
    return isControlled || labelsRoot || rectangleNearRoot(rect, rootRect)
  })
}

function snapshotOf(root: HTMLElement): InteractionSnapshot {
  const rootRect = root.getBoundingClientRect()
  const nodes: SnapshotNode[] = []
  const candidates = [root, ...(Array.from(root.querySelectorAll('*')) as HTMLElement[])]
  const bodyElements = document.body
    ? Array.from(document.body.querySelectorAll('*')).filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      )
    : []
  const overlayRoots = relatedOverlayRoots(root, rootRect, bodyElements)
  const detached = bodyElements.filter((node) =>
    overlayRoots.some((overlayRoot) => overlayRoot === node || overlayRoot.contains(node)),
  )
  const all = [...candidates, ...detached]
  const order = new Map(all.map((element, index) => [element, index]))
  all.sort(
    (a, b) =>
      snapshotPriority(b, root, overlayRoots) - snapshotPriority(a, root, overlayRoots) ||
      (order.get(a) ?? 0) - (order.get(b) ?? 0),
  )
  const seen = new Set<string>()
  for (const element of all) {
    if (nodes.length >= MAX_SNAPSHOT_NODES) break
    const node = snapshotNode(element, rootRect)
    if (!node || seen.has(node.uid)) continue
    seen.add(node.uid)
    nodes.push(node)
  }
  const active = document.activeElement
  return {
    rootUid: uidFor(root),
    focusedUid: active instanceof HTMLElement ? uidFor(active) : undefined,
    nodes,
  }
}

function mutationSummary(record: MutationRecord): InteractionMutation {
  const target = record.target instanceof HTMLElement ? uidFor(record.target) : undefined
  const addedUids = Array.from(record.addedNodes)
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .slice(0, 12)
    .map((node) => uidFor(node))
  const removedUids = Array.from(record.removedNodes)
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .slice(0, 12)
    .map((node) => uidFor(node))
  return {
    type: record.type,
    targetUid: target,
    addedUids: addedUids.length ? addedUids : undefined,
    removedUids: removedUids.length ? removedUids : undefined,
    attributeNames: record.attributeName ? [record.attributeName] : undefined,
  }
}

function nodeMap(snapshot: InteractionSnapshot): Map<string, SnapshotNode> {
  return new Map(snapshot.nodes.map((node) => [node.uid, node]))
}

function changedNodes(
  before: InteractionSnapshot,
  after: InteractionSnapshot,
): { changed: string[]; geometryChanges: InteractionEvidence['geometryChanges']; added: string[] } {
  const oldNodes = nodeMap(before)
  const newNodes = nodeMap(after)
  const changed: string[] = []
  const added: string[] = []
  const geometryChanges: InteractionEvidence['geometryChanges'] = []
  for (const [uid, next] of newNodes) {
    const previous = oldNodes.get(uid)
    if (!previous) {
      added.push(uid)
      changed.push(uid)
      continue
    }
    if (
      JSON.stringify(previous.state) !== JSON.stringify(next.state) ||
      previous.accessibleName !== next.accessibleName ||
      previous.labelledBy !== next.labelledBy ||
      previous.controls !== next.controls ||
      previous.hasPopup !== next.hasPopup ||
      JSON.stringify(previous.attributes) !== JSON.stringify(next.attributes) ||
      JSON.stringify(previous.rect) !== JSON.stringify(next.rect)
    ) {
      changed.push(uid)
    }
    if (JSON.stringify(previous.rect) !== JSON.stringify(next.rect)) {
      geometryChanges.push({ uid, before: previous.rect, after: next.rect })
    }
  }
  for (const uid of oldNodes.keys()) {
    if (!newNodes.has(uid)) changed.push(uid)
  }
  return { changed: [...new Set(changed)], geometryChanges, added }
}

function nameOf(el: HTMLElement): string {
  return [accessibleNameOf(el), el.getAttribute('type'), el.className]
    .filter((value): value is string => Boolean(value))
    .join(' ')
}

function candidatesOf(root: HTMLElement): Candidate[] {
  const controls = [
    root,
    ...Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, summary, [role], [aria-haspopup], [aria-expanded], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
      ),
    ),
  ]
  const seen = new Set<HTMLElement>()
  const candidates: Candidate[] = []
  for (const element of controls) {
    if (
      seen.has(element) ||
      !isVisible(element) ||
      element.getAttribute('aria-disabled') === 'true'
    )
      continue
    seen.add(element)
    const tag = element.tagName.toLowerCase()
    const name = nameOf(element)
    const hasMenuSemantics =
      tag === 'summary' ||
      element.hasAttribute('aria-haspopup') ||
      element.hasAttribute('aria-expanded') ||
      ['combobox', 'listbox'].includes(element.getAttribute('role') ?? '') ||
      SAFE_NAME_RE.test(name)
    const blocked =
      BLOCKED_NAME_RE.test(name) ||
      (tag === 'button' && (element.getAttribute('type') ?? 'submit') !== 'button') ||
      element.hasAttribute('href')
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable) {
      candidates.push({ el: element, event: 'focus', risk: 'safe' })
    } else if (hasMenuSemantics && !blocked) {
      candidates.push({ el: element, event: 'click', risk: 'safe' })
    } else if (blocked) {
      candidates.push({ el: element, event: 'click', risk: 'blocked' })
    } else if (tag === 'button') {
      candidates.push({ el: element, event: 'click', risk: 'review' })
    }
  }
  const riskOrder: Record<Candidate['risk'], number> = { safe: 0, review: 1, blocked: 2 }
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => riskOrder[a.candidate.risk] - riskOrder[b.candidate.risk] || a.index - b.index)
    .slice(0, MAX_INTERACTION_CANDIDATES)
    .map(({ candidate }) => candidate)
}

function changedDescription(
  before: InteractionSnapshot,
  after: InteractionSnapshot,
  changed: string[],
  added: string[],
  focusChanged = false,
): string | undefined {
  const oldNodes = nodeMap(before)
  const newNodes = nodeMap(after)
  const details: string[] = []
  for (const uid of changed.slice(0, 8)) {
    const oldNode = oldNodes.get(uid)
    const newNode = newNodes.get(uid)
    if (!oldNode || !newNode) continue
    if (oldNode.state?.expanded !== newNode.state?.expanded) {
      details.push(
        `expanded ${oldNode.state?.expanded ?? 'unknown'} -> ${newNode.state?.expanded ?? 'unknown'}`,
      )
    }
    if (oldNode.accessibleName !== newNode.accessibleName) details.push('accessible name changed')
  }
  if (added.length) details.push(`${added.length} visible node(s) appeared`)
  if (focusChanged) {
    details.push(`focus ${before.focusedUid ?? 'none'} -> ${after.focusedUid ?? 'none'}`)
  }
  if (details.length) return details.join('; ')
  return changed.length ? `${changed.length} node(s) changed` : undefined
}

function waitForSettledUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 80)
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80)))
  })
}

function restoreCandidate(
  candidate: Candidate,
  before: InteractionSnapshot,
  after: InteractionSnapshot,
): void {
  if (candidate.risk !== 'safe' || candidate.event !== 'click') return
  const beforeNode = nodeMap(before).get(uidFor(candidate.el))
  const afterNode = nodeMap(after).get(uidFor(candidate.el))

  const details = candidate.el.closest('details')
  const detailsUid = details ? uidFor(details) : undefined
  const beforeDetails = detailsUid ? nodeMap(before).get(detailsUid) : undefined
  const afterDetails = detailsUid ? nodeMap(after).get(detailsUid) : undefined
  const expandedChanged =
    beforeNode?.state?.expanded !== afterNode?.state?.expanded ||
    beforeDetails?.state?.expanded !== afterDetails?.state?.expanded

  if (expandedChanged) {
    candidate.el.click()
  }
}

function restoreFocus(focusedUid: string | undefined, fallback?: HTMLElement): void {
  if (!focusedUid) {
    if (fallback && document.activeElement === fallback) fallback.blur()
    return
  }
  const element = elementForUid(focusedUid)
  if (!element || !element.isConnected || !isVisible(element)) return
  element.focus({ preventScroll: true })
}

function overlayUidsOf(root: HTMLElement, changedUids: string[]): string[] {
  return changedUids.filter((uid) => {
    const element = elementForUid(uid)
    return Boolean(element && element instanceof HTMLElement && isOverlayLike(element, root))
  })
}

/** Probe only low-risk controls and return observable before/after evidence. */
export async function collectInteractionEvidence(
  root: HTMLElement,
): Promise<InteractionEvidence[]> {
  const results: InteractionEvidence[] = []
  for (const [index, candidate] of candidatesOf(root).entries()) {
    const before = snapshotOf(root)
    const mutations: InteractionMutation[] = []
    const observer =
      typeof MutationObserver === 'function'
        ? new MutationObserver((records) => {
            mutations.push(...records.slice(0, 32).map(mutationSummary))
          })
        : undefined
    if (observer && document.body) {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'aria-expanded',
          'aria-selected',
          'aria-checked',
          'aria-pressed',
          'aria-hidden',
          'class',
          'style',
          'open',
        ],
      })
    }
    const focusBefore = before.focusedUid
    let probeFailed = false
    try {
      try {
        if (candidate.risk === 'safe') {
          if (candidate.event === 'focus') candidate.el.focus({ preventScroll: true })
          else candidate.el.click()
          await waitForSettledUi()
        }
      } catch {
        // A page handler can throw or synchronously tear down the candidate.
        // Keep the probe as unknown instead of failing the complete analysis.
        probeFailed = true
      }
      const after = snapshotOf(root)
      const diff = changedNodes(before, after)
      const focusAfter = after.focusedUid
      const focusChanged = focusBefore !== focusAfter
      const changedNodeUids = [
        ...new Set([...diff.changed, ...(focusChanged && focusAfter ? [focusAfter] : [])]),
      ]
      const observed =
        !probeFailed && (diff.changed.length > 0 || mutations.length > 0 || focusChanged)
      const overlayUids = overlayUidsOf(root, changedNodeUids)
      const observedBehavior =
        changedDescription(before, after, changedNodeUids, diff.added, focusChanged) ??
        (focusChanged
          ? `focus ${focusBefore ?? 'none'} -> ${focusAfter ?? 'none'}`
          : mutations.length
            ? `${mutations.length} DOM mutation(s) observed`
            : undefined)
      results.push({
        id: `interaction-${index + 1}`,
        triggerUid: uidFor(candidate.el),
        triggerName: accessibleNameOf(candidate.el),
        event: candidate.event,
        risk: candidate.risk,
        status: candidate.risk === 'blocked' ? 'blocked' : observed ? 'observed' : 'unknown',
        before,
        after,
        mutations: mutations.slice(0, 32),
        geometryChanges: diff.geometryChanges.slice(0, 32),
        focusBefore,
        focusAfter,
        changedNodeUids: changedNodeUids.slice(0, 64),
        relatedNodeUids: [uidFor(candidate.el), ...changedNodeUids.slice(0, 32)],
        overlayUids: overlayUids.slice(0, 32),
        observedBehavior: probeFailed
          ? 'Safe probe failed before a reliable result; behavior remains unknown.'
          : observedBehavior,
        confidence: candidate.risk === 'blocked' ? 1 : probeFailed ? 0.1 : observed ? 0.9 : 0.35,
      })
      try {
        restoreCandidate(candidate, before, after)
        restoreFocus(focusBefore, candidate.el)
      } catch {
        // Restoration is best effort; never turn a page-specific handler error
        // into a failed full component capture.
      }
      await waitForSettledUi()
    } finally {
      observer?.disconnect()
    }
  }
  return results
}
