import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/** Colors the legacy `@codemirror/legacy-modes/mode/stex` mode's tokens.
 * No custom `tokenTable` is needed: `StreamLanguage`'s `TokenTable`
 * pre-seeds "tag"/"builtin"/"error" (among others) to `tagName`/
 * `variableName.standard`/`invalid` before ever consulting a parser-
 * supplied table, and every other token stex.js emits ("atom", "comment",
 * "bracket", "keyword", "number", "variableName.special") already matches
 * a real `@lezer/highlight` tag name directly — verified against the
 * installed `@codemirror/language` source, not assumed. */
export const latexHighlightStyle = HighlightStyle.define([
  { tag: tags.tagName, color: "var(--syntax-command)" }, // \section, \cite, ...
  { tag: tags.atom, color: "var(--syntax-env)" }, // \begin{name}/\usepackage{name}
  // \importmodule{...}'s two args (sTeX-only, essentially never seen in a
  // real FreeLeaf document) — not worth a dedicated color, reuse env's.
  { tag: tags.string, color: "var(--syntax-env)" },
  { tag: tags.standard(tags.variableName), color: "var(--syntax-env)" },
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: tags.bracket, color: "var(--syntax-bracket)" },
  { tag: tags.keyword, color: "var(--syntax-math-delim)" }, // $ \( \) \[ \]
  { tag: tags.special(tags.variableName), color: "var(--syntax-math-var)", fontStyle: "italic" },
  { tag: tags.number, color: "var(--syntax-number)" },
  // tags.invalid ("error": unrecognized math-mode content) intentionally
  // has no rule — Polishing mode's lint squiggles already flag problems;
  // don't double-signal with a second visual channel here.
]);

export const latexSyntaxHighlighting = syntaxHighlighting(latexHighlightStyle);
