import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import { applyAndCloseBrace } from "./completionUtils";

// Matches while the cursor is inside an unclosed \usepackage{...} (or
// \RequirePackage{...}), an optional [options] group before the brace, and
// (like \cite) a comma-separated list so `\usepackage{amsmath, graphicx|}`
// completes the *current* segment rather than the whole thing.
const PACKAGE_COMMAND_RE = /\\(?:usepackage|RequirePackage)(?:\[[^[\]]*\])?\{([^{}]*)$/;

/** A curated list of commonly used CTAN packages — not exhaustive (that
 * would mean fetching/caching CTAN's full package index), but covers the
 * large majority of what real LaTeX documents actually `\usepackage`.
 * Static and bundled: no network round-trip, no cache invalidation story,
 * same "quick and simple over complete" tradeoff as the environment list. */
const COMMON_PACKAGES: { name: string; detail: string }[] = [
  { name: "amsmath", detail: "AMS math environments and commands" },
  { name: "amssymb", detail: "AMS symbols and fonts" },
  { name: "amsthm", detail: "Theorem, lemma, proof environments" },
  { name: "amsfonts", detail: "AMS fonts" },
  { name: "mathtools", detail: "Extensions and fixes for amsmath" },
  { name: "graphicx", detail: "Include and transform images" },
  { name: "graphics", detail: "Basic image inclusion (predates graphicx)" },
  { name: "xcolor", detail: "Color support" },
  { name: "color", detail: "Basic color support" },
  { name: "hyperref", detail: "Clickable links, PDF metadata, bookmarks" },
  { name: "url", detail: "Typeset URLs, breaking at sensible points" },
  { name: "geometry", detail: "Page margins and layout" },
  { name: "fancyhdr", detail: "Custom headers and footers" },
  { name: "titlesec", detail: "Customize section/chapter titles" },
  { name: "setspace", detail: "Line spacing (single/double/custom)" },
  { name: "booktabs", detail: "Publication-quality table rules" },
  { name: "array", detail: "Extended column types for tabular" },
  { name: "tabularx", detail: "Tables with auto-sized columns" },
  { name: "longtable", detail: "Tables that span multiple pages" },
  { name: "multirow", detail: "Table cells spanning multiple rows" },
  { name: "multicol", detail: "Multiple text columns" },
  { name: "caption", detail: "Customize figure/table caption styling" },
  { name: "subcaption", detail: "Sub-figures with their own captions" },
  { name: "float", detail: "Control over float placement (e.g. [H])" },
  { name: "wrapfig", detail: "Wrap text around figures" },
  { name: "tikz", detail: "Vector graphics and diagrams" },
  { name: "pgfplots", detail: "Plots and charts built on TikZ" },
  { name: "pgf", detail: "Low-level graphics system underlying TikZ" },
  { name: "listings", detail: "Typeset source code with syntax highlighting" },
  { name: "minted", detail: "Syntax-highlighted code via Pygments" },
  { name: "verbatim", detail: "Verbatim text blocks" },
  { name: "algorithm", detail: "Float wrapper for algorithms" },
  { name: "algpseudocode", detail: "Pseudocode typesetting" },
  { name: "algorithmic", detail: "Pseudocode typesetting (older style)" },
  { name: "biblatex", detail: "Modern bibliography management" },
  { name: "natbib", detail: "Flexible citation styles" },
  { name: "cite", detail: "Compress and sort numeric citations" },
  { name: "babel", detail: "Multilingual typesetting support" },
  { name: "polyglossia", detail: "Multilingual support for XeLaTeX/LuaLaTeX" },
  { name: "inputenc", detail: "Input character encoding (mostly legacy)" },
  { name: "fontenc", detail: "Font encoding" },
  { name: "fontspec", detail: "System font selection for XeLaTeX/LuaLaTeX" },
  { name: "csquotes", detail: "Context-sensitive quotation marks" },
  { name: "microtype", detail: "Micro-typographic refinements" },
  { name: "lmodern", detail: "Latin Modern fonts" },
  { name: "mathpazo", detail: "Palatino-based math and text fonts" },
  { name: "newtxtext", detail: "Times-like text font" },
  { name: "newtxmath", detail: "Times-like math font" },
  { name: "enumitem", detail: "Customize list spacing and labels" },
  { name: "parskip", detail: "Paragraph spacing instead of indentation" },
  { name: "indentfirst", detail: "Indent the first paragraph of a section" },
  { name: "changepage", detail: "Temporarily change page layout" },
  { name: "lipsum", detail: "Placeholder ('lorem ipsum') text" },
  { name: "todonotes", detail: "Inline TODO/margin notes" },
  { name: "xspace", detail: "Smart spacing after macros" },
  { name: "xparse", detail: "Modern LaTeX3 command definitions" },
  { name: "etoolbox", detail: "Programming toolbox for macros" },
  { name: "ifthen", detail: "Conditional logic in macros" },
  { name: "calc", detail: "Arithmetic in LaTeX length/counter expressions" },
  { name: "siunitx", detail: "SI units and number formatting" },
  { name: "physics", detail: "Shorthand macros for physics notation" },
  { name: "chemfig", detail: "Chemical structure diagrams" },
  { name: "mhchem", detail: "Chemical formulas and equations" },
  { name: "nomencl", detail: "Nomenclature/list of symbols" },
  { name: "glossaries", detail: "Glossaries and acronym lists" },
  { name: "makeidx", detail: "Index generation" },
  { name: "imakeidx", detail: "Index generation (no external makeindex call)" },
  { name: "appendix", detail: "Extra control over appendices" },
  { name: "authblk", detail: "Author/affiliation block formatting" },
  { name: "abstract", detail: "Customize the abstract environment" },
  { name: "footmisc", detail: "Footnote formatting options" },
  { name: "endnotes", detail: "Endnotes instead of footnotes" },
  { name: "hyphenat", detail: "Manual hyphenation control" },
  { name: "soul", detail: "Letterspacing, underlining, highlighting" },
  { name: "ulem", detail: "Underline and strikethrough" },
  { name: "textcomp", detail: "Extra text symbols" },
  { name: "pifont", detail: "Dingbat symbols (e.g. checkmarks)" },
  { name: "rotating", detail: "Rotate figures, tables, and text" },
  { name: "pdfpages", detail: "Include pages from external PDFs" },
  { name: "adjustbox", detail: "Resize, trim, and frame content boxes" },
  { name: "subfig", detail: "Sub-figures (legacy alternative to subcaption)" },
  { name: "epigraph", detail: "Chapter/section epigraphs" },
  { name: "epsfig", detail: "Legacy EPS figure inclusion" },
  { name: "tocbibind", detail: "Add bibliography/index to the table of contents" },
  { name: "tocloft", detail: "Customize table of contents formatting" },
  { name: "titletoc", detail: "Customize table of contents entries" },
  { name: "hyperxmp", detail: "Embed XMP metadata for hyperref" },
  { name: "bookmark", detail: "Fine-grained PDF bookmark control" },
  { name: "cleveref", detail: "Smart cross-references (\"Figure 3\" vs bare numbers)" },
  { name: "varioref", detail: "Page-aware cross-references (\"on the next page\")" },
  { name: "xr", detail: "Cross-reference labels across documents" },
  { name: "comment", detail: "Exclude blocks of source text" },
  { name: "environ", detail: "Define environments that capture their body" },
  { name: "tikz-cd", detail: "Commutative diagrams with TikZ" },
  { name: "forest", detail: "Tree diagrams" },
  { name: "circuitikz", detail: "Circuit diagrams with TikZ" },
  { name: "listofitems", detail: "Parse comma/space-separated lists" },
  { name: "datetime2", detail: "Flexible date/time formatting" },
  { name: "layout", detail: "Visualize the current page layout" },
  { name: "afterpage", detail: "Defer commands until after the current page" },
  { name: "needspace", detail: "Force a page break if not enough space remains" },
  { name: "placeins", detail: "Prevent floats from crossing a \\FloatBarrier" },
  { name: "morewrites", detail: "Increase the number of available \\write streams" },
  { name: "acronym", detail: "Acronym lists" },
  { name: "supertabular", detail: "Multi-page tables (alternative to longtable)" },
  { name: "collcell", detail: "Apply a command to every cell of a column" },
  { name: "colortbl", detail: "Colored table rows, columns, and cells" },
  { name: "dcolumn", detail: "Align table columns on a decimal point" },
];

export function packageCompletionSource() {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(PACKAGE_COMMAND_RE);
    if (!match) return null;
    const groups = PACKAGE_COMMAND_RE.exec(match.text);
    if (!groups) return null;

    const inner = groups[1];
    const segment = inner.slice(inner.lastIndexOf(",") + 1);
    const trimmed = segment.replace(/^\s+/, "");
    const from = match.to - trimmed.length;

    return {
      from,
      options: COMMON_PACKAGES.map((pkg) => ({
        label: pkg.name,
        detail: pkg.detail,
        type: "keyword",
        apply: applyAndCloseBrace,
      })),
      filter: true,
    };
  };
}
