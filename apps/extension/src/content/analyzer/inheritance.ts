/**
 * 继承分析（§9）：判断关键继承属性（font-family / color）来自直接定义、祖先继承还是系统默认。
 */

export type InheritanceSource = 'direct' | 'inherited' | 'system'

function hasOwnDeclaration(el: HTMLElement, prop: string): boolean {
  const inline = el.style.getPropertyValue(prop)
  if (inline) return true
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules) as CSSRule[]) {
        if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) continue
        if (rule instanceof CSSStyleRule && el.matches(rule.selectorText)) {
          if (rule.style.getPropertyValue(prop)) return true
        }
      }
    } catch {
      // 跨域 sheet 忽略
    }
  }
  return false
}

function hasAnyAncestorDeclaration(el: HTMLElement, prop: string): boolean {
  let node = el.parentElement
  while (node) {
    if (hasOwnDeclaration(node, prop)) return true
    node = node.parentElement
  }
  return false
}

/** 判断 font-family 来源（direct / inherited / system） */
export function detectFontSource(el: HTMLElement): InheritanceSource {
  if (hasOwnDeclaration(el, 'font-family')) return 'direct'
  if (hasAnyAncestorDeclaration(el, 'font-family')) return 'inherited'
  return 'system'
}

/** 判断 color 来源 */
export function detectColorSource(el: HTMLElement): InheritanceSource {
  if (hasOwnDeclaration(el, 'color')) return 'direct'
  if (hasAnyAncestorDeclaration(el, 'color')) return 'inherited'
  return 'system'
}
