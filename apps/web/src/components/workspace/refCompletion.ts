import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

// Matches while the cursor is inside an unclosed \ref{...} (or a variant
// command) — same shape as citeCompletion.ts's CITE_COMMAND_RE.
const REF_COMMAND_RE = /\\(?:ref|eqref|pageref|nameref|[Cc]ref)\{([^{}]*)$/;

const SECTIONING_RE = /\\(chapter|section|subsection|subsubsection|paragraph)\*?\{([^}]*)\}/;
const BEGIN_RE = /\\begin\{([^}]+)\}/;
const END_RE = /\\end\{([^}]+)\}/;
const CAPTION_RE = /\\caption\{([^}]*)\}/;
const LABEL_DEF_RE = /\\label\{([^}]+)\}/g;

// Environments a \label is commonly attached to via a preceding \caption —
// same "best-effort, not a real parser" scope as polishingLint.ts: doesn't
// handle nested braces in caption text, or labels defined in other files
// (\input/\include) — only the current file's content is scanned.
const FLOAT_ENV_KIND: Record<string, string> = {
  figure: "Figure", "figure*": "Figure",
  table: "Table", "table*": "Table",
  equation: "Equation", "equation*": "Equation",
  align: "Equation", "align*": "Equation",
  gather: "Equation", "gather*": "Equation",
};

export interface LabelInfo {
  key: string;
  description: string;
}

export function extractLabels(text: string): LabelInfo[] {
  const labels: LabelInfo[] = [];
  const envStack: string[] = [];
  let currentSectionTitle: string | null = null;
  let lastCaptionInEnv: string | null = null;

  for (const line of text.split("\n")) {
    const sectionMatch = line.match(SECTIONING_RE);
    if (sectionMatch) currentSectionTitle = sectionMatch[2];

    const beginMatch = line.match(BEGIN_RE);
    if (beginMatch) {
      envStack.push(beginMatch[1]);
      lastCaptionInEnv = null;
    }
    const endMatch = line.match(END_RE);
    if (endMatch) {
      envStack.pop();
      lastCaptionInEnv = null;
    }

    const captionMatch = line.match(CAPTION_RE);
    if (captionMatch) lastCaptionInEnv = captionMatch[1];

    LABEL_DEF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LABEL_DEF_RE.exec(line))) {
      const currentEnv = envStack[envStack.length - 1];
      const kind = currentEnv ? FLOAT_ENV_KIND[currentEnv] : undefined;
      let description = "";
      if (kind && lastCaptionInEnv) description = `${kind}: ${lastCaptionInEnv}`;
      else if (kind) description = kind;
      else if (currentSectionTitle) description = `Section: ${currentSectionTitle}`;
      labels.push({ key: m[1], description });
    }
  }
  return labels;
}

export function refCompletionSource(getLabels: () => LabelInfo[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(REF_COMMAND_RE);
    if (!match) return null;
    const groups = REF_COMMAND_RE.exec(match.text);
    if (!groups) return null;

    const inner = groups[1];
    const segment = inner.slice(inner.lastIndexOf(",") + 1);
    const trimmed = segment.replace(/^\s+/, "");
    const from = match.to - trimmed.length;

    const labels = getLabels();
    if (labels.length === 0) return null;

    return {
      from,
      options: labels.map((l) => ({
        label: l.key,
        detail: l.description || undefined,
        type: "text",
      })),
      filter: true,
    };
  };
}
