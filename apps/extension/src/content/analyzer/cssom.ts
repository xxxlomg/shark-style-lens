import type { AnalysisWarning, CSSVariableUsage } from '../../shared/schemas/style-profile'
import { sanitizeCssValue, sanitizeReferenceUrl } from './privacy'

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
        resolvedValue: sanitizeCssValue(resolve(name) || name),
        sourceElement,
        sourceRule,
        scope: 'self',
      })
    }
  }
  return out
}

/**
 * CSSOM 规则溯源：尝试定位影响目标元素的匹配规则与 CSS 变量。
 * 跨域 stylesheet 受浏览器安全策略限制 → 容错并产出 CROSS_ORIGIN_CSSOM warning。
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

  const walkRules = (cssRules: CSSRuleList | null, media?: string, stylesheetUrl?: string) => {
    if (!cssRules) return
    for (const rule of Array.from(cssRules) as CSSRule[]) {
      if (rule instanceof CSSMediaRule) {
        const mediaText = media ? `${media} and ${rule.media.mediaText}` : rule.media.mediaText
        if (mediaText && !window.matchMedia(mediaText).matches) continue
        walkRules(rule.cssRules, mediaText, stylesheetUrl)
        continue
      }
      if (rule instanceof CSSSupportsRule) {
        if (
          typeof CSS !== 'undefined' &&
          typeof CSS.supports === 'function' &&
          !CSS.supports(rule.conditionText)
        )
          continue
        walkRules(rule.cssRules, media, stylesheetUrl)
        continue
      }
      if (!(rule instanceof CSSStyleRule)) continue
      const matchedProps: Record<string, string> = {}
      for (const prop of props) {
        const value = rule.style.getPropertyValue(prop)
        if (value) matchedProps[prop] = sanitizeCssValue(value)
      }
      if (Object.keys(matchedProps).length === 0) continue
      let matches = false
      try {
        matches = el.matches(rule.selectorText)
      } catch {
        // Invalid selectors from a third-party sheet must not hide other rules.
        continue
      }
      if (matches) {
        rules.push({
          selector: rule.selectorText,
          stylesheetUrl: stylesheetUrl ? sanitizeReferenceUrl(stylesheetUrl) : undefined,
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
        walkRules(sheet.cssRules, undefined, sheet.href || undefined)
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
