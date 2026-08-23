/** 元素 ↔ uid 双向注册表（会话内稳定，供跨消息引用） */

const elToUid = new WeakMap<HTMLElement, string>()
const uidToEl = new Map<string, HTMLElement>()
let counter = 0

export function uidFor(el: HTMLElement): string {
  let uid = elToUid.get(el)
  if (!uid) {
    uid = `n-${++counter}`
    elToUid.set(el, uid)
    uidToEl.set(uid, el)
  }
  return uid
}

export function elementForUid(uid: string): HTMLElement | null {
  return uidToEl.get(uid) ?? null
}
