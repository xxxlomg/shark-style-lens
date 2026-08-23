/** 已锁定目标元素注册表（uid → element），供分析运行器按 uid 取回元素 */

const targetElements = new Map<string, HTMLElement>()

export function registerTarget(uid: string, el: HTMLElement) {
  targetElements.set(uid, el)
}

export function targetElement(uid: string): HTMLElement | null {
  return targetElements.get(uid) ?? null
}
