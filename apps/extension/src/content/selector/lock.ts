import type { SelectedElement } from '../../shared/schemas/messages'
import { useSelectionStore } from '../state/stores'

/** 当前 hover 目标（仅在选择模式下有效） */
export let currentHoverEl: HTMLElement | null = null

export function setCurrentHover(el: HTMLElement | null) {
  currentHoverEl = el
}

let uidCounter = 0

/** 生成稳定 selector 路径（限深，供 re-select / 调试） */
export function buildSelector(el: HTMLElement, maxDepth = 3): string {
  const parts: string[] = []
  let node: HTMLElement | null = el
  while (node && parts.length < maxDepth) {
    let part = node.tagName.toLowerCase()
    if (node.id) part += `#${node.id}`
    const classes = Array.from(node.classList).slice(0, 2)
    if (classes.length) part += `.${classes.join('.')}`
    parts.unshift(part)
    node = node.parentElement
  }
  return parts.join(' > ')
}

function rectToJson(r: DOMRect) {
  return {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    left: r.left,
  }
}

/** 锁定目标：生成 SelectedElement、写入 store、上报 background（MESSAGE_PROTOCOL） */
export function lockElement(
  el: HTMLElement,
  scope: 'element' | 'component' = 'element',
): SelectedElement {
  const info: SelectedElement = {
    uid: `t-${++uidCounter}`,
    tagName: el.tagName.toLowerCase(),
    selector: buildSelector(el),
    rect: rectToJson(el.getBoundingClientRect()),
    classes: Array.from(el.classList),
    scope,
  }
  useSelectionStore.getState().setTarget(info)
  chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', payload: info }).catch(() => {
    /* background 校验失败等场景静默（UI 状态不受影响） */
  })
  return info
}

/** 更新已锁定目标的 scope（element ↔ component，§5） */
export function setTargetScope(scope: 'element' | 'component') {
  const target = useSelectionStore.getState().target
  if (!target) return
  const updated: SelectedElement = { ...target, scope }
  useSelectionStore.getState().setTarget(updated)
  chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', payload: updated }).catch(() => {})
}

/** 清除选择状态（模式回退由 dispatchUi 驱动） */
export function clearTarget() {
  currentHoverEl = null
  useSelectionStore.getState().setTarget(undefined)
}

/** 发起分析（ANALYSIS_START → 状态机 ANALYZE；Sprint 3 接入真实 Analyzer） */
export function startAnalysis() {
  const target = useSelectionStore.getState().target
  if (!target) return
  const payload = {
    targetUid: target.uid,
    scope: target.scope,
    options: { includePseudoElements: true },
  }
  chrome.runtime.sendMessage({ type: 'ANALYSIS_START', payload }).catch(() => {})
}
