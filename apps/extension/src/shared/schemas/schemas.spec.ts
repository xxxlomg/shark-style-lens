import { describe, expect, it } from 'vitest'
import { extensionMessageSchema } from './messages'
import { styleProfileSchema, type StyleProfile } from './style-profile'

/** 取自 docs/STYLE_PROFILE_SCHEMA.md §19 的 Button 示例（字段子集完整化） */
function buttonProfile(): StyleProfile {
  return {
    version: '0.1.0',
    target: {
      uid: 't-0001',
      tagName: 'BUTTON',
      role: 'button',
      classes: ['btn', 'btn-primary'],
      attributes: { type: 'submit' },
      textContent: 'Get Started',
      childCount: 2,
      rect: {
        x: 540,
        y: 412,
        width: 128,
        height: 40,
        top: 412,
        right: 668,
        bottom: 452,
        left: 540,
      },
      selector: 'main > section > div.card > div.card-footer > button.btn-primary',
      isShadowBoundary: false,
      insideIframe: false,
    },
    context: {
      componentBoundary: {
        kind: 'card',
        confidence: 0.82,
        evidence: ['visual-enclosure', 'padding-container'],
      },
      outerLayoutContext: ['section', 'grid'],
      ancestors: [{ uid: 'n-0004', tagName: 'DIV', classes: ['card-footer'], childCount: 2 }],
      siblings: [{ uid: 'n-0005', tagName: 'A', classes: ['btn-ghost'], childCount: 1 }],
      children: [
        { uid: 'n-0010', tagName: 'SPAN', classes: ['btn-label'], childCount: 0 },
        { uid: 'n-0011', tagName: 'SPAN', classes: ['btn-icon'], childCount: 0 },
      ],
    },
    structure: {
      domTree: [
        {
          uid: 't-0001',
          tagName: 'BUTTON',
          classes: ['btn'],
          attributes: {},
          childCount: 2,
          depth: 0,
        },
        {
          uid: 'n-0010',
          tagName: 'SPAN',
          classes: ['btn-label'],
          attributes: {},
          childCount: 0,
          depth: 1,
        },
      ],
    },
    layout: {
      display: 'inline-flex',
      position: 'static',
      positionContext: 'static (document flow)',
      overflow: 'visible',
      flex: {
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '8px',
        items: [],
      },
      semanticDescription:
        'Compact horizontal inline-flex action control with centered content and stable icon/text gap.',
    },
    spacing: {
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      padding: { top: '0px', right: '16px', bottom: '0px', left: '16px' },
      boxSizing: 'border-box',
      renderedSize: { width: 128, height: 40 },
      layoutSize: { width: 128, height: 40 },
    },
    typography: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontFamilySource: 'inherited',
      fontSize: '14px',
      fontWeight: '600',
      lineHeight: '40px',
      letterSpacing: '0.01em',
      textAlign: 'center',
      whiteSpace: 'nowrap',
      semanticRole: 'action-label',
    },
    visual: {
      color: { observed: 'rgb(255, 255, 255)', normalized: '#ffffff' },
      background: {
        kind: 'color',
        color: { observed: 'rgb(99, 102, 241)', normalized: '#6366f1', token: '--color-primary' },
        semanticDescription: 'Solid accent surface',
      },
      shadows: [],
      pseudoElements: [],
    },
    assets: [],
    responsive: {
      viewport: { width: 1440, height: 900 },
      devicePixelRatio: 1,
      colorScheme: 'light',
      matchedMediaQueries: ['(min-width: 1024px)'],
      rootFontSize: '16px',
      themeSummary: 'light theme, neutral surface, blue accent token',
    },
    states: [{ state: 'default', captured: true }],
    facts: [
      { property: 'display', value: 'inline-flex', source: 'computed', confidence: 1 },
      { property: 'background-color', value: '#6366f1', source: 'variable', confidence: 1 },
      {
        property: 'font-family',
        value: 'Inter, system-ui, sans-serif',
        source: 'inheritance',
        confidence: 1,
      },
    ],
    inferences: [
      {
        type: 'component-type',
        conclusion: 'Primary action button inside a pricing card footer.',
        confidence: 0.85,
        reason: ['inline-flex display', 'solid accent background', 'semantic tag BUTTON'],
      },
    ],
    warnings: [
      {
        code: 'CROSS_ORIGIN_CSSOM',
        message: 'Some stylesheet rules could not be inspected.',
        severity: 'info',
      },
    ],
  }
}

describe('styleProfileSchema', () => {
  it('accepts the Button example profile', () => {
    const result = styleProfileSchema.safeParse(buttonProfile())
    expect(result.success).toBe(true)
  })

  it('rejects profiles that mix inference into facts', () => {
    // 推断不得伪装为观察事实：非法 source 值必须被拒绝
    const invalid = {
      ...buttonProfile(),
      facts: [
        ...buttonProfile().facts,
        { property: 'x', value: 'y', source: 'guessed', confidence: 1 },
      ],
    }
    expect(styleProfileSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects missing required fields', () => {
    const { target: _target, ...rest } = buttonProfile()
    expect(styleProfileSchema.safeParse(rest).success).toBe(false)
  })
})

describe('extensionMessageSchema', () => {
  it('accepts valid messages', () => {
    expect(extensionMessageSchema.safeParse({ type: 'SELECTION_START' }).success).toBe(true)
    expect(
      extensionMessageSchema.safeParse({
        type: 'ELEMENT_SELECTED',
        payload: {
          uid: 't-1',
          tagName: 'BUTTON',
          selector: 'button',
          rect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
          classes: [],
          scope: 'element',
        },
      }).success,
    ).toBe(true)
    expect(
      extensionMessageSchema.safeParse({ type: 'STYLE_PROFILE_READY', payload: buttonProfile() })
        .success,
    ).toBe(true)
  })

  it('rejects unknown types and malformed payloads', () => {
    expect(extensionMessageSchema.safeParse({ type: 'NOPE' }).success).toBe(false)
    expect(
      extensionMessageSchema.safeParse({ type: 'ANALYSIS_START', payload: { targetUid: 42 } })
        .success,
    ).toBe(false)
    expect(
      extensionMessageSchema.safeParse({ type: 'ELEMENT_SELECTED', payload: {} }).success,
    ).toBe(false)
  })
})
