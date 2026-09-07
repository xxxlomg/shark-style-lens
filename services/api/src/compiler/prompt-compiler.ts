import type { CompiledContext, ProviderOptions } from "../providers/types";
import type { LightProfile, LightSubtreeNode } from "./types";
import { buildEvidencePack } from "./evidence-pack";

const HIGH_VALUE_PROPS = new Set([
  "display",
  "position",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "align-self",
  "grid-template-columns",
  "grid-template-rows",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration",
  "white-space",
  "word-break",
  "color",
  "background-color",
  "background-image",
  "background-size",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "box-shadow",
  "opacity",
  "transform",
  "z-index",
]);

const FRAMEWORK_NOTES: Record<
  NonNullable<ProviderOptions["targetFramework"]>,
  string
> = {
  agnostic:
    "Implement with plain HTML/CSS or any framework; do not assume a specific one.",
  react:
    "Implement as a React component with inline styles or CSS modules; do not use a specific UI library.",
  vue: "Implement as a Vue single-file component with scoped styles.",
  "html-css": "Implement as plain HTML + CSS.",
  tailwind:
    "Implement using Tailwind CSS utility classes; do not use custom component libraries.",
  nextjs: "Implement as a Next.js (App Router) React component.",
};

export interface PromptSection {
  title: string;
  lines: string[];
}

interface EvidenceLedger {
  browserFacts: string[];
  visualObservations: string[];
  derivedConstraints: string[];
  unknowns: string[];
  conflicts: string[];
}

export function compilePromptContext(
  profile: LightProfile,
  options: ProviderOptions = {},
): CompiledContext {
  const framework = options.targetFramework ?? "agnostic";
  const sections: PromptSection[] = [];
  const evidencePack = buildEvidencePack(profile);
  const ledger = buildEvidenceLedger(profile);
  ledger.conflicts = evidencePack.conflicts.map(formatConflict);
  ledger.unknowns = unique([...ledger.unknowns, ...evidencePack.unknowns]);
  const tree = profile.componentTree ?? [];
  const pageContext = profile.pageContext;
  const visual = profile.visual ?? {};

  sections.push({
    title: "Goal",
    lines: [
      "Recreate the selected UI as closely as possible to the observed result.",
      "Prioritize visual fidelity over source-code similarity.",
      "Implement the complete bounded component, including every visible descendant and interactive control.",
      "Do not reproduce the original frontend framework, component library, selectors, or class names.",
    ],
  });

  sections.push({
    title: "Evidence Status",
    lines: [
      `Capture scope: ${profile.analysisScope ?? "element"}; analysis root: <${profile.target.tagName}> (${profile.target.uid}).`,
      profile.target.selectedUid
        ? `The clicked descendant was ${profile.target.selectedUid}; the bounded reconstruction root is ${profile.target.uid}.`
        : "The clicked node is also the analysis root.",
      profile.responsive?.viewport
        ? `Viewport: ${profile.responsive.viewport.width} × ${profile.responsive.viewport.height}px; device pixel ratio: ${profile.responsive.devicePixelRatio ?? 1}.`
        : "Viewport metadata: unknown.",
      `Browser evidence: ${ledger.browserFacts.length} measured claims${profile.matchedRules?.length ? ` and ${profile.matchedRules.length} accessible matched CSS rules` : ""}.`,
      profile.componentCapture
        ? `Component capture: ${profile.componentCapture.capturedNodes} nodes, ${profile.componentCapture.capturedInteractiveNodes} interactive; omitted ${profile.componentCapture.omittedNodes} nodes${profile.componentCapture.truncated ? " because the capture was truncated" : ""}.`
        : "Component capture statistics: unavailable.",
      profile.visionEvidence
        ? `Visual evidence: ${profile.visionEvidence.source} analysis, overall confidence ${Math.round(profile.visionEvidence.analysis.overallConfidence * 100)}%.`
        : "Visual evidence: unavailable; do not invent screenshot-only paint details.",
      `Interaction evidence: ${evidencePack.interactionContracts.length} contract(s) including observed, unknown, and safety-blocked controls.`,
      "Original source code, framework identity, hidden behavior, and uncaptured interaction states are not evidence.",
      "Browser-observed facts:",
      ...ledger.browserFacts,
      "Visual observations:",
      ...ledger.visualObservations,
      "Inferences and derived constraints:",
      ...ledger.derivedConstraints,
      ...(profile.inferences ?? []).map(
        (inference) =>
          `Inference (${Math.round(inference.confidence * 100)}%): ${inference.conclusion}; reason: ${inference.reason.join(", ") || "not supplied"}.`,
      ),
      ...(profile.warnings ?? []).map(
        (warning) => `Warning (${warning.severity}): ${warning.message}`,
      ),
    ],
  });

  sections.push({
    title: "Evidence Reconciliation",
    lines: [
      `EvidencePack ${evidencePack.schemaVersion}: ${evidencePack.claims.length} unified claims; ${evidencePack.conflicts.length} conflict(s); ${evidencePack.unknowns.length} unknown or limitation(s).`,
      "Browser facts are authoritative for CSS declarations, native state, and measured geometry. Screenshot observations are authoritative for composited paint, occlusion, clipping, edge softness, and visual grouping.",
      ...(evidencePack.conflicts.length
        ? evidencePack.conflicts.map(formatConflict)
        : [
            "No source conflict was detected. Preserve unknown behavior as unknown.",
          ]),
    ],
  });

  const boundary = profile.context?.componentBoundary;
  sections.push({
    title: "Component Context",
    lines: boundary
      ? [
          profile.analysisScope === "component"
            ? `The selected UI is a complete "${boundary.kind}" component, not an isolated element.`
            : `This element appears to be part of a "${boundary.kind}" component (confidence ${Math.round(boundary.confidence * 100)}%).`,
          `Boundary root: ${boundary.rootUid ?? profile.target.uid}${boundary.rootTagName ? ` (<${boundary.rootTagName}>)` : ""}.`,
          `Boundary evidence: ${boundary.evidence.join(", ") || "none supplied"}.`,
          ...(profile.context?.outerLayoutContext?.length
            ? [
                `Outer layout context: ${profile.context.outerLayoutContext.join(" -> ")}.`,
              ]
            : []),
        ]
      : [
          "The element stands alone; no clear enclosing component was detected.",
        ],
  });

  sections.push({
    title: "Component Inventory",
    lines: [
      tree.length > 0
        ? "Every visible bounded descendant is listed below. Preserve this hierarchy and relative geometry."
        : "No bounded descendant tree was captured; the visible child inventory is unknown.",
      ...treeInventoryLines(tree),
    ],
  });

  sections.push({
    title: "Interaction Inventory",
    lines: [
      "Implement every listed observed control. Inferred action labels are hypotheses, not proof of business behavior.",
      ...interactionInventoryLines(tree),
    ],
  });

  sections.push({
    title: "Interaction Contracts",
    lines: [
      "The contracts below are the only behavior evidence captured from the source page. Implement observed transitions and preserve unknown or blocked behavior as explicitly marked.",
      ...interactionContractLines(evidencePack.interactionContracts),
    ],
  });

  const layout = profile.layout ?? {};
  sections.push({
    title: "Layout",
    lines: [
      layout.semanticDescription ??
        `display: ${layout.display ?? "n/a"}; position: ${layout.position ?? "n/a"}.`,
      layout.flex ? `Flex: ${JSON.stringify(layout.flex)}.` : "",
      layout.grid ? `Grid: ${JSON.stringify(layout.grid)}.` : "",
      `Box model: ${JSON.stringify(profile.spacing ?? {})}`,
    ].filter(Boolean),
  });

  const spacing = profile.spacing;
  sections.push({
    title: "Spacing",
    lines: spacing
      ? [
          `Padding: ${formatEdges(spacing.padding)}; Margin: ${formatEdges(spacing.margin)}.`,
          spacing.gap ? `Child gap: ${spacing.gap}.` : "",
          `Rendered size: ${spacing.renderedSize?.width} × ${spacing.renderedSize?.height}px (box-sizing: ${spacing.boxSizing}).`,
        ].filter(Boolean)
      : ["Spacing measurements are unknown."],
  });

  const typography = profile.typography ?? {};
  sections.push({
    title: "Typography",
    lines: [
      `Font: ${typography.fontFamily ?? "inherited"} (${typography.fontFamilySource ?? "computed"}).`,
      `Size: ${typography.fontSize ?? "n/a"}; Weight: ${typography.fontWeight ?? "n/a"}; Line-height: ${typography.lineHeight ?? "n/a"}${typography.letterSpacing ? `; Letter-spacing: ${typography.letterSpacing}` : ""}.`,
      `Align: ${typography.textAlign ?? "n/a"}${typography.semanticRole ? `; Semantic role: "${typography.semanticRole}"` : ""}.`,
      "Preserve observed wrapping and text density; do not replace visible labels with generic filler.",
    ],
  });

  const background = visual.background;
  sections.push({
    title: "Colors and Surfaces",
    lines: [
      pageContext
        ? `Page scheme: ${pageContext.scheme}${pageContext.pageBackground ? `; page background: ${pageContext.pageBackground}` : ""}.`
        : "Page theme: unknown.",
      pageContext?.palette?.length
        ? `Page palette: ${pageContext.palette.map((entry) => `${entry.hex} (${entry.usage} x${entry.count})`).join(", ")}.`
        : "",
      background?.kind === "color" && background.color
        ? `Background: ${background.color.observed} (#${background.color.normalized.replace("#", "")})${background.color.token ? ` via token ${background.color.token}` : ""}.`
        : background?.kind === "gradient"
          ? `Background: gradient ${background.gradient}${background.color ? ` over ${background.color.observed}` : ""}.`
          : background?.kind === "image"
            ? `Background: image-based surface${background.color ? ` over ${background.color.observed}` : ""}; exact asset identity is unknown.`
            : "Background: none/transparent.",
      visual.color
        ? `Foreground: ${visual.color.observed}${visual.color.token ? ` via token ${visual.color.token}` : ""}.`
        : "",
      visual.border
        ? `Border: ${visual.border.width} ${visual.border.style}${visual.border.color ? ` ${visual.border.color.observed}` : ""}${visual.border.sides ? `; sides: ${JSON.stringify(visual.border.sides)}` : ""}.`
        : "Border: none.",
      visual.radius
        ? `Corner radius: ${visual.radius.summary ?? visual.radius.topLeft ?? "observed per-corner values"}.`
        : "Corner radius: none.",
      pageContext?.pageBackground && background?.color
        ? surfaceContrastLine(
            background.color.observed,
            pageContext.pageBackground,
          )
        : "",
      ...(visual.shadows ?? []).map(
        (shadow) =>
          `Shadow: ${shadow.semanticDescription ?? `${shadow.offsetX} ${shadow.offsetY} ${shadow.blur} ${shadow.spread}`}; color ${formatColor(shadow.color)}.`,
      ),
      visual.backdropFilter ? `Backdrop filter: ${visual.backdropFilter}.` : "",
      visual.filter ? `Filter: ${visual.filter}.` : "",
      visual.transform
        ? `Transform: ${visual.transform}${visual.transformOrigin ? `; origin ${visual.transformOrigin}` : ""}.`
        : "",
      visual.clipPath ? `Clip path: ${visual.clipPath}.` : "",
      visual.maskImage ? `Mask image: ${visual.maskImage}.` : "",
      visual.mixBlendMode ? `Mix blend mode: ${visual.mixBlendMode}.` : "",
      visual.isolation ? `Isolation: ${visual.isolation}.` : "",
    ].filter(Boolean),
  });

  sections.push({
    title: "Assets",
    lines: profile.assets?.length
      ? profile.assets.map(
          (asset) =>
            `${asset.kind}: ${asset.description ?? "asset"}; dimensions ${asset.width ?? "unknown"} × ${asset.height ?? "unknown"}; exact URL is ${asset.hasUrl ? "intentionally withheld" : "unknown"}.`,
        )
      : ["No image, SVG, icon, or video asset identity was captured."],
  });

  sections.push({
    title: "Unknowns and Conflicts",
    lines: [
      ...ledger.unknowns.map((unknown) => `Unknown: ${unknown}`),
      ...ledger.conflicts.map((conflict) => `Conflict: ${conflict}`),
      ledger.unknowns.length === 0 && ledger.conflicts.length === 0
        ? "No unresolved unknowns or conflicts were explicitly recorded. Do not infer hidden behavior from convention."
        : "Resolve conflicts using the stated source precedence; never silently replace a browser fact with a visual guess.",
    ],
  });

  sections.push({
    title: "Implementation Requirements",
    lines: [
      FRAMEWORK_NOTES[framework],
      "Use semantic HTML and accessible keyboard/focus behavior.",
      "Implement every visible child region and every interactive descendant listed above, including toolbars, selects/dropdowns, optimize actions, send actions, icons, badges, dividers, and text areas when present.",
      "Use browser-observed geometry and computed style values for dimensions and layout. Use screenshot observations for paint, visual grouping, clipping, and occlusion.",
      "Do not copy source selectors or framework-specific class names. Do not invent business behavior that was not captured.",
    ],
  });

  sections.push({
    title: "Fidelity Checklist",
    lines: [
      "Verify the analysis-root boundary, dimensions, hierarchy, relative coordinates, spacing, alignment, and overflow at the captured viewport.",
      "Verify typography family/source, size, weight, line-height, wrapping, and text density.",
      "Verify page background, foreground, surfaces, gradients, alpha, borders, radii, shadows, filters, icons, and pseudo-elements.",
      "Verify every Component Inventory item and every Interaction Inventory item is implemented; never replace observed structure with generic placeholder content or reduce a composite component to a single input or card.",
      "Verify every observed Interaction Contract: reproduce its trigger, native/accessibility semantics, state transition, focus result, visible added/removed nodes, geometry changes, and Portal/overlay relationship. Do not invent behavior for unknown or safety-blocked contracts.",
      "Render and compare against the target crop before optimizing code structure; report unresolved unknowns and conflicts.",
    ],
  });

  return {
    markdown: renderMarkdown(sections),
    data: {
      sections,
      observedFacts: ledger.browserFacts,
      browserFacts: ledger.browserFacts,
      visualObservations: ledger.visualObservations,
      derivedConstraints: ledger.derivedConstraints,
      evidencePack,
      visionEvidence: profile.visionEvidence,
      inferences: profile.inferences ?? [],
      unknowns: ledger.unknowns,
      conflicts: ledger.conflicts,
      warnings: profile.warnings ?? [],
    },
  };
}

function formatConflict(conflict: {
  claim: string;
  candidates: Array<{ source: string; value: unknown }>;
  resolution: { rule: string; implementationConstraint: string };
}): string {
  return `${conflict.claim}; candidates: ${conflict.candidates.map((candidate) => `${candidate.source}=${JSON.stringify(candidate.value)}`).join(" vs ")}; resolution: ${conflict.resolution.rule}; constraint: ${conflict.resolution.implementationConstraint}.`;
}

function buildEvidenceLedger(profile: LightProfile): EvidenceLedger {
  const browserFacts = (profile.facts ?? [])
    .filter((fact) => HIGH_VALUE_PROPS.has(fact.property))
    .slice(0, 120)
    .map((fact) => {
      const target =
        fact.targetUid && fact.targetUid !== profile.target.uid
          ? `[${fact.targetUid}] `
          : "";
      const confidence =
        fact.confidence === undefined
          ? ""
          : `; confidence ${Math.round(fact.confidence * 100)}%`;
      return `${target}${fact.property}: ${fact.value} [${fact.source}${confidence}]`;
    });

  const visualObservations: string[] = [];
  const vision = profile.visionEvidence;
  if (vision) {
    const analysis = vision.analysis;
    visualObservations.push(
      `Source: ${vision.source}; overall confidence ${Math.round(analysis.overallConfidence * 100)}%.`,
      `Visual boundary: ${analysis.componentBoundary.kind} (${Math.round(analysis.componentBoundary.confidence * 100)}%): ${analysis.componentBoundary.evidence.join(", ") || "no evidence supplied"}.`,
      analysis.visualGrouping.relationships.length
        ? `Visual grouping: ${analysis.visualGrouping.relationships.join("; ")}.`
        : "",
      ...analysis.visualSemantics.map(
        (item) =>
          `Visual semantic: ${item.element} likely serves ${item.role} (${Math.round(item.confidence * 100)}%).${item.description ? ` ${item.description}` : ""}${item.bounds ? ` Bounds ${formatBounds(item.bounds)}.` : ""}${item.relation ? ` Relation: ${item.relation}.` : ""}`,
      ),
      ...(analysis.visibleRegions ?? []).map(
        (region) =>
          `Visible region: ${region.name}${region.role ? ` (${region.role})` : ""}${region.bounds ? ` at ${formatBounds(region.bounds)}` : ""}${region.relation ? `; relation: ${region.relation}` : ""}; ${region.description} (${Math.round(region.confidence * 100)}%). Evidence: ${region.evidence.join(", ") || "none"}.`,
      ),
      ...analysis.stateChanges.map(
        (item) => `Visual state ${item.state}: ${item.changes.join("; ")}.`,
      ),
      ...analysis.consistencyChecks.map(
        (item) =>
          `DOM-vision check (${item.status}): ${formatConsistencyCheck(item)}.`,
      ),
      ...(analysis.appearance
        ? [
            analysis.appearance.appearanceDescription
              ? `Appearance: ${analysis.appearance.appearanceDescription}`
              : "",
            analysis.appearance.surfaceTreatment
              ? `Surface treatment: ${analysis.appearance.surfaceTreatment}`
              : "",
            analysis.appearance.palette.length
              ? `Vision palette: ${analysis.appearance.palette.join(", ")}`
              : "",
            ...analysis.appearance.subcomponents.map(
              (item) =>
                `Subcomponent "${item.name}": ${item.description}${item.bounds ? ` at ${formatBounds(item.bounds)}` : ""}${item.relation ? `; relation: ${item.relation}` : ""}.`,
            ),
          ]
        : []),
    );
  }

  const derivedConstraints: string[] = [];
  const root = profile.componentTree?.[0];
  if (root?.rect)
    derivedConstraints.push(
      `Descendant coordinates are CSS-pixel offsets relative to the analysis root; root size is ${root.rect.width} × ${root.rect.height}px.`,
    );
  if (root?.children?.length) {
    const order = root.children
      .filter((child) => child.rect)
      .map((child) => `${child.tagName} (${child.rect?.x},${child.rect?.y})`)
      .join(" -> ");
    if (order)
      derivedConstraints.push(`Direct-child measured order: ${order}.`);
  }
  if (profile.matchedRules?.length)
    derivedConstraints.push(
      ...profile.matchedRules.slice(0, 30).map((rule) => {
        const properties = Object.entries(rule.properties)
          .filter(([property]) => HIGH_VALUE_PROPS.has(property))
          .map(([property, value]) => `${property}=${value}`)
          .join(", ");
        return `CSS rule evidence (selector is reference only; do not copy it): ${rule.selector}${rule.media ? ` in ${rule.media}` : ""} -> ${properties || "no high-value properties"}.`;
      }),
    );
  if (profile.cssVariables?.length)
    derivedConstraints.push(
      ...profile.cssVariables
        .slice(0, 40)
        .map(
          (variable) =>
            `CSS variable ${variable.name} resolves to ${variable.resolvedValue}${variable.sourceRule ? ` from ${variable.sourceRule}` : ""}.`,
        ),
    );

  const unknowns: string[] = [];
  const conflicts: string[] = [];
  if (!vision)
    unknowns.push(
      "No screenshot/Vision evidence was available for paint and visual grouping.",
    );
  if (vision) {
    unknowns.push(...vision.analysis.unknowns);
    for (const check of vision.analysis.consistencyChecks) {
      if (check.status === "conflict")
        conflicts.push(
          `${formatConsistencyCheck(check)}; evidence: ${check.evidence.join(", ") || "none"}.`,
        );
      if (check.status === "unknown")
        unknowns.push(
          `${formatConsistencyCheck(check)}; evidence: ${check.evidence.join(", ") || "none"}.`,
        );
    }
  }
  for (const state of profile.states ?? [])
    if (!state.captured)
      unknowns.push(`The ${state.state} state was not captured.`);
  for (const warning of profile.warnings ?? [])
    if (warning.severity !== "info") unknowns.push(warning.message);
  if (!profile.componentTree?.length)
    unknowns.push("The bounded component tree is empty.");

  return {
    browserFacts: unique(
      browserFacts.length
        ? browserFacts
        : ["No high-value computed facts were captured."],
    ),
    visualObservations: unique(
      visualObservations.length
        ? visualObservations
        : ["No Vision observations were captured."],
    ),
    derivedConstraints: unique(
      derivedConstraints.length
        ? derivedConstraints
        : ["No additional deterministic relationship was derived."],
    ),
    unknowns: unique(unknowns),
    conflicts: unique(conflicts),
  };
}

function treeInventoryLines(tree: LightSubtreeNode[]): string[] {
  const lines: string[] = [];
  const walk = (
    nodes: LightSubtreeNode[],
    depth: number,
    parentPath: string,
  ) => {
    nodes.forEach((node, index) => {
      const path = `${parentPath} > child[${(node.childIndex ?? index) + 1}]`;
      const bits = [
        `${"  ".repeat(depth)}- ${path}: <${node.tagName}> role:${node.roleGuess}`,
      ];
      if (node.semanticRole) bits.push(`semantic-role ${node.semanticRole}`);
      if (node.interactive) bits.push("interactive");
      if (node.nativeRole) bits.push(`native-role ${node.nativeRole}`);
      if (node.accessibleName)
        bits.push(`accessible-name "${node.accessibleName}"`);
      if (node.labelledBy) bits.push(`labelled-by ${node.labelledBy}`);
      if (node.controls) bits.push(`controls ${node.controls}`);
      if (node.hasPopup) bits.push(`has-popup ${node.hasPopup}`);
      if (node.visibilityState && node.visibilityState !== "visible")
        bits.push(`visibility ${node.visibilityState}`);
      if (node.effectiveOpacity !== undefined)
        bits.push(`effective-opacity ${node.effectiveOpacity}`);
      if (node.actionHint) bits.push(`hint ${node.actionHint}`);
      if (node.state) {
        const state = Object.entries(node.state)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => `${key}=${value}`)
          .join(",");
        if (state) bits.push(`state ${state}`);
      }
      if (node.rect)
        bits.push(
          `${Math.round(node.rect.width)}×${Math.round(node.rect.height)}px @(${node.rect.x},${node.rect.y})`,
        );
      if (node.layout) bits.push(node.layout);
      if (node.background) bits.push(`bg ${node.background}`);
      if (node.color) bits.push(`color ${node.color}`);
      if (node.border) bits.push(`border ${node.border}`);
      if (node.radius) bits.push(`radius ${node.radius}`);
      if (node.shadow) bits.push(`shadow ${node.shadow}`);
      if (node.typography)
        bits.push(
          `font ${node.typography.fontSize}/${node.typography.fontWeight}, line-height ${node.typography.lineHeight}`,
        );
      if (node.control) bits.push(formatControl(node.control));
      if (node.computed) {
        const computed = Object.entries(node.computed)
          .filter(([property]) => HIGH_VALUE_PROPS.has(property))
          .slice(0, 18)
          .map(([property, value]) => `${property}=${value}`);
        if (computed.length) bits.push(`computed ${computed.join(", ")}`);
      }
      if (node.pseudoElements?.length)
        bits.push(
          `pseudo ${node.pseudoElements.map((pseudo) => `${pseudo.pseudo}${pseudo.inferredPurpose ? `:${pseudo.inferredPurpose}` : ""}`).join(", ")}`,
        );
      if (node.textContent) bits.push(`text "${node.textContent}"`);
      lines.push(bits.join(" | "));
      walk(node.children, depth + 1, path);
    });
  };
  walk(tree, 0, "root");
  return lines;
}

function interactionInventoryLines(tree: LightSubtreeNode[]): string[] {
  const lines: string[] = [];
  const walk = (nodes: LightSubtreeNode[], parentPath: string) => {
    nodes.forEach((node, index) => {
      const path = `${parentPath} > child[${(node.childIndex ?? index) + 1}]`;
      if (
        node.interactive ||
        ["button", "input", "control"].includes(node.roleGuess)
      ) {
        lines.push(
          [
            `${path}: <${node.tagName}> role:${node.roleGuess}`,
            node.nativeRole ? `native-role ${node.nativeRole}` : "",
            node.accessibleName
              ? `accessible-name "${node.accessibleName}"`
              : "",
            node.labelledBy ? `labelled-by ${node.labelledBy}` : "",
            node.controls ? `controls ${node.controls}` : "",
            node.hasPopup ? `has-popup ${node.hasPopup}` : "",
            node.control ? formatControl(node.control) : "",
            node.textContent ? `label/text "${node.textContent}"` : "",
            node.actionHint ?? "",
            node.state
              ? `state ${Object.entries(node.state)
                  .filter(([, value]) => value !== undefined)
                  .map(([key, value]) => `${key}=${value}`)
                  .join(",")}`
              : "",
          ]
            .filter(Boolean)
            .join("; "),
        );
      }
      walk(node.children, path);
    });
  };
  walk(tree, "root");
  return lines.length
    ? lines
    : ["No interactive descendant was observed in the bounded tree."];
}

function interactionContractLines(
  contracts: Array<Record<string, unknown>>,
): string[] {
  if (!contracts.length) return ["No interaction contract was captured."];

  return contracts.map((contract) => {
    const before = recordValue(contract.before);
    const after = recordValue(contract.after);
    const beforeNodes = arrayValue(before?.nodes);
    const afterNodes = arrayValue(after?.nodes);
    const changed = stringArrayValue(contract.changedNodeUids);
    const overlays = stringArrayValue(contract.overlayUids);
    const mutations = arrayValue(contract.mutations);
    const details = [
      `${String(contract.id ?? "interaction")}: trigger ${String(contract.triggerUid ?? "unknown")}${contract.triggerName ? ` (${String(contract.triggerName)})` : ""}; ${String(contract.event ?? "unknown")} / risk ${String(contract.risk ?? "unknown")} / status ${String(contract.status ?? "unknown")}; confidence ${Math.round(Number(contract.confidence ?? 0) * 100)}%.`,
      `Before: ${snapshotNodeLines(beforeNodes).join("; ") || "no relevant visible nodes"}.`,
      `After: ${snapshotNodeLines(afterNodes).join("; ") || "no relevant visible nodes"}.`,
      `Changed nodes: ${changed.length ? changed.join(", ") : "none"}.`,
      `Focus: ${String(contract.focusBefore ?? "none")} -> ${String(contract.focusAfter ?? "none")}.`,
      `Visible overlays/Portal nodes: ${overlays.length ? overlays.join(", ") : "none observed"}.`,
      `Mutations: ${mutations.length ? mutations.map((mutation) => JSON.stringify(mutation)).join("; ") : "none observed"}.`,
      contract.observedBehavior
        ? `Observed behavior: ${String(contract.observedBehavior)}.`
        : "Observed behavior: none; keep this behavior unknown.",
    ];
    return details.join(" ");
  });
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function snapshotNodeLines(nodes: unknown[]): string[] {
  return nodes.slice(0, 12).flatMap((value) => {
    const node = recordValue(value);
    if (!node) return [];
    const state = recordValue(node.state);
    const stateText = state
      ? Object.entries(state)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => `${key}=${String(item)}`)
          .join(",")
      : "";
    return [
      `${String(node.uid ?? "unknown")} <${String(node.tagName ?? "unknown")}>${node.accessibleName ? ` name="${String(node.accessibleName)}"` : ""}${node.visible === false ? " hidden" : ""}${stateText ? ` state(${stateText})` : ""}`,
    ];
  });
}

function formatControl(
  control: NonNullable<LightSubtreeNode["control"]>,
): string {
  const details = [`control ${control.kind}`];
  if (control.type) details.push(`type=${control.type}`);
  if (control.placeholder) details.push(`placeholder="${control.placeholder}"`);
  if (control.title) details.push(`title="${control.title}"`);
  if (control.name) details.push(`name="${control.name}"`);
  if (control.required !== undefined)
    details.push(`required=${control.required}`);
  if (control.readOnly !== undefined)
    details.push(`readOnly=${control.readOnly}`);
  if (control.valuePresent !== undefined)
    details.push(
      `value present=${control.valuePresent}; actual value withheld`,
    );
  if (control.options?.length) {
    details.push(
      `options=${control.options
        .map(
          (option) =>
            `${option.label}${option.selected ? " [selected]" : ""}${option.disabled ? " [disabled]" : ""}`,
        )
        .join(" | ")}`,
    );
  }
  return details.join(" ");
}

function formatBounds(bounds: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  coordinateSpace?: string;
}): string {
  const space = bounds.coordinateSpace ? ` ${bounds.coordinateSpace}` : "";
  return `${bounds.width ?? "?"}×${bounds.height ?? "?"} @(${bounds.x ?? "?"},${bounds.y ?? "?"})${space}`;
}

function formatConsistencyCheck(item: {
  property?: string;
  claim?: string;
  browserValue?: unknown;
  visualValue?: unknown;
  resolution?: string;
}): string {
  if (
    item.property ||
    item.browserValue !== undefined ||
    item.visualValue !== undefined
  ) {
    return `${item.property ?? "unspecified property"}: browser=${JSON.stringify(item.browserValue ?? null)}, visual=${JSON.stringify(item.visualValue ?? null)}, resolution=${item.resolution ?? "unknown"}`;
  }
  return item.claim ?? "unspecified consistency check";
}

function formatColor(value: unknown): string {
  if (value && typeof value === "object" && "observed" in value) {
    const observed = (value as { observed?: unknown }).observed;
    if (typeof observed === "string") return observed;
  }
  return String(value ?? "unknown");
}

function formatEdges(edges?: Record<string, string>): string {
  if (!edges) return "n/a";
  return `${edges.top ?? "0"} ${edges.right ?? "0"} ${edges.bottom ?? "0"} ${edges.left ?? "0"}`;
}

function parseRgb(value: string): [number, number, number] | null {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (!hex) return null;
  const number = Number.parseInt(hex[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function surfaceContrastLine(surface: string, page: string): string {
  const surfaceRgb = parseRgb(surface);
  const pageRgb = parseRgb(page);
  if (!surfaceRgb || !pageRgb)
    return "Surface contrast: preserve the measured surface/page relationship.";
  const brightness = (rgb: [number, number, number]) =>
    (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  const surfaceDark = brightness(surfaceRgb) < 0.35;
  const pageDark = brightness(pageRgb) < 0.35;
  if (surfaceDark && pageDark)
    return "Surface contrast: dark surface on a dark page; preserve the subtle dark-on-dark edge/border treatment.";
  if (surfaceDark)
    return "Surface contrast: dark surface on a light page (strong contrast).";
  if (pageDark)
    return "Surface contrast: light surface on a dark page (strong contrast).";
  return "Surface contrast: light surface on a light page.";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function renderMarkdown(sections: PromptSection[]): string {
  return [
    "# Recreate This UI Component",
    "",
    ...sections.flatMap((section) => [
      `## ${section.title}`,
      "",
      ...section.lines,
      "",
    ]),
  ].join("\n");
}
