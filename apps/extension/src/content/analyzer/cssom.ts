import type { AnalysisWarning, CSSVariableUsage } from '../../shared/schemas/style-profile'

export interface RuleHit {
  selector: string
  stylesheetUrl?: string
  media?: string
  properties: Record<string, string>
  accessible: boolean
}

const VAR_RE = /var\((--[\w-]+)/g

function collectVariablesFromDeclarations(
  declarations: Record<string, string>,
  sourceElement: string,
  sourceRule: string,
  resolve: (name: string) => string,
): CSSVariableUsage[] {
  const seen = new Set<string>()
  const out: CSSVariableUsage[] = []
  for (const value of Object.values(declarations)) {
    for (const m of value.matchAll(VAR_RE)) {
      const name = m[1]
      if (seen.has(name)) continue
      seen.add(name)
      out.push({
        name,
        resolvedValue: resolve(name) || name,
        sourceElement,
        sourceRule,
        scope: 'self',
      })
    }
  }
  return out
}

/**
 * CSSOM 规则溯源（§8.2）：尝试定位影响目标元素的匹配规则与 CSS 变量。
 * 跨域 stylesheet 受浏览器安全策略限制 → 容错并产出 CROSS_ORIGIN_CSSOM warning（§41）。
 */
export function inspectCssom(
  el: HTMLElement,
  props: string[],
): { rules: RuleHit[]; variables: CSSVariableUsage[]; warnings: AnalysisWarning[] } {
  const rules: RuleHit[] = []
  const variables: CSSVariableUsage[] = []
  const warnings: AnalysisWarning[] = []
  let crossOriginSeen = false

  const resolveVar = (name: string) => getComputedStyle(el).getPropertyValue(name).trim()

  const walkRules = (cssRules: CSSRuleList | null, media?: string) => {
    if (!cssRules) return
    for (const rule of Array.from(cssRules) as CSSRule[]) {
      if (rule instanceof CSSMediaRule) {
        walkRules(rule.cssRules, rule.media.mediaText)
        continue
      }
      if (rule instanceof CSSSupportsRule) {
        walkRules(rule.cssRules, media)
        continue
      }
      if (!(rule instanceof CSSStyleRule)) continue
      const matchedProps: Record<string, string> = {}
      for (const prop of props) {
        const value = rule.style.getPropertyValue(prop)
        if (value) matchedProps[prop] = value
      }
      if (Object.keys(matchedProps).length === 0) continue
      if (el.matches(rule.selectorText)) {
        rules.push({
          selector: rule.selectorText,
          media,
          properties: matchedProps,
          accessible: true,
        })
        variables.push(
          ...collectVariablesFromDeclarations(
            matchedProps,
            el.tagName,
            rule.selectorText,
            resolveVar,
          ),
        )
      }
    }
  }

  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walkRules(sheet.cssRules)
      } catch {
        // 跨域 stylesheet：cssRules 访问抛异常
        crossOriginSeen = true
      }
    }
  } catch {
    crossOriginSeen = true
  }

  if (crossOriginSeen) {
    warnings.push({
      code: 'CROSS_ORIGIN_CSSOM',
      message:
        'Some stylesheet rules could not be inspected due to browser security restrictions; analysis continues using computed styles.',
      severity: 'info',
    })
  }

  return { rules, variables, warnings }
}
