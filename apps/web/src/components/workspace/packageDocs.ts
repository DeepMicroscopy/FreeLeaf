export interface PackageDoc {
  description: string;
  example: string;
  image: string;
}

export const PACKAGE_DOCS: Record<string, PackageDoc> = {
  amsmath: {
    description:
      "AMS math environments and commands — aligned equations, multi-line derivations, and much more math notation than plain LaTeX supports.",
    example: `\\[
  \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
\\]
\\begin{align}
  a &= b + c \\\\
    &= d
\\end{align}`,
    image: "/package-docs/amsmath.png",
  },
  amssymb: {
    description:
      "Extra AMS symbols and blackboard-bold letters (\\mathbb, \\gtrsim, \\subseteq, and many more).",
    example: `Let $x \\in \\mathbb{R}$, $A \\subseteq \\mathbb{N}$, and $f \\colon A \\to \\mathbb{R}$.\\\\
Then $\\forall\\, \\varepsilon > 0,\\ \\exists\\, n \\gtrsim \\varepsilon^{-1}$ such that $\\Vert f(n) \\Vert \\leq \\varepsilon$.`,
    image: "/package-docs/amssymb.png",
  },
  graphicx: {
    description: "Include and transform images (\\includegraphics) — resizing, rotation, clipping.",
    example: `\\includegraphics[width=4cm]{sample.png}`,
    image: "/package-docs/graphicx.png",
  },
  xcolor: {
    description:
      "Color support for text, backgrounds, and rules — named colors, mixing (blue!70!black), and more.",
    example: `{\\color{blue!70!black}\\Large Custom colors}\\\\[4pt]
\\textcolor{orange!80!red}{Highlighted} text and \\colorbox{yellow!40}{a background}.`,
    image: "/package-docs/xcolor.png",
  },
  hyperref: {
    description:
      "Clickable links, PDF metadata, and bookmarks — turns \\ref/\\cite and URLs into real hyperlinks in the PDF.",
    example: `\\href{https://ctan.org}{A clickable link to CTAN}, styled by \\texttt{colorlinks=true}.`,
    image: "/package-docs/hyperref.png",
  },
  geometry: {
    description:
      "Page margins and layout — set with one \\usepackage option instead of manual \\hoffset/\\voffset tweaking.",
    example: `Body text on a page with margins set by a single
\\verb|\\usepackage[margin=1cm]{geometry}| option.`,
    image: "/package-docs/geometry.png",
  },
  booktabs: {
    description:
      "Publication-quality table rules (\\toprule/\\midrule/\\bottomrule) — no vertical lines, consistent spacing.",
    example: `\\begin{tabular}{lrr}
\\toprule
Method & Accuracy & Time (s) \\\\
\\midrule
Baseline & 82.1\\% & 0.4 \\\\
Ours & \\textbf{91.7\\%} & 0.6 \\\\
\\bottomrule
\\end{tabular}`,
    image: "/package-docs/booktabs.png",
  },
  tabularx: {
    description: "Tables with an auto-sized column (X) that stretches to fill the table width.",
    example: `\\begin{tabularx}{6.5cm}{lX}
\\toprule
Term & Definition \\\\
\\midrule
Fixpoint & A value left unchanged by a function's own application \\\\
\\bottomrule
\\end{tabularx}`,
    image: "/package-docs/tabularx.png",
  },
  multirow: {
    description: "Table cells that span multiple rows.",
    example: `\\begin{tabular}{|c|c|c|}
\\hline
\\multirow{2}{*}{Group} & A & 12 \\\\
\\cline{2-3}
 & B & 9 \\\\
\\hline
\\end{tabular}`,
    image: "/package-docs/multirow.png",
  },
  longtable: {
    description: "Tables that span multiple pages, repeating the header row on each page.",
    example: `\\begin{longtable}{ll}
\\toprule
Symbol & Meaning \\\\
\\midrule
\\endhead
$\\alpha$ & significance level \\\\
$\\beta$ & type II error rate \\\\
\\bottomrule
\\end{longtable}`,
    image: "/package-docs/longtable.png",
  },
  caption: {
    description: "Customize figure/table caption styling — font, label style, spacing.",
    example: `\\begin{figure}[h]
\\centering
\\includegraphics[width=3cm]{sample.png}
\\caption{A figure with a smaller, customized caption font.}
\\end{figure}`,
    image: "/package-docs/caption.png",
  },
  subcaption: {
    description: "Sub-figures with their own labels/captions, grouped under one overall caption.",
    example: `\\begin{figure}[h]
\\centering
\\begin{subfigure}{0.45\\linewidth}
  \\includegraphics[width=\\linewidth]{sample.png}
  \\caption{First}
\\end{subfigure}
\\hfill
\\begin{subfigure}{0.45\\linewidth}
  \\includegraphics[width=\\linewidth]{sample.png}
  \\caption{Second}
\\end{subfigure}
\\caption{Two sub-figures side by side.}
\\end{figure}`,
    image: "/package-docs/subcaption.png",
  },
  float: {
    description:
      "Extra float-placement specifiers, most notably [H] to force a figure to stay exactly where it is in the source.",
    example: `\\begin{figure}[H]
\\centering
\\includegraphics[width=3cm]{sample.png}
\\caption{Forced to stay exactly here with \\texttt{[H]}.}
\\end{figure}`,
    image: "/package-docs/float.png",
  },
  tikz: {
    description: "Vector graphics and diagrams drawn directly in LaTeX — axes, shapes, plots, node diagrams.",
    example: `\\begin{tikzpicture}
  \\draw[thick,->] (0,0) -- (3,0) node[right]{$x$};
  \\draw[thick,->] (0,0) -- (0,2) node[above]{$y$};
  \\draw[blue,thick] (0,0) parabola (2,1.6);
  \\filldraw[red] (1,0.8) circle (2pt);
\\end{tikzpicture}`,
    image: "/package-docs/tikz.png",
  },
  pgfplots: {
    description: "Data plots and charts built on TikZ — axes, legends, function/data plotting.",
    example: `\\begin{tikzpicture}
\\begin{axis}[width=6.5cm,height=4.5cm,xlabel=$x$,ylabel=$\\sin(x)$]
  \\addplot[domain=0:6.28,samples=50] {sin(deg(x))};
\\end{axis}
\\end{tikzpicture}`,
    image: "/package-docs/pgfplots.png",
  },
  listings: {
    description: "Typeset source code with syntax highlighting for many languages.",
    example: `\\begin{lstlisting}[language=Python]
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
\\end{lstlisting}`,
    image: "/package-docs/listings.png",
  },
  biblatex: {
    description:
      "Modern bibliography management — flexible citation/bibliography styles, Unicode-native, actively developed (vs. the older bibtex).",
    example: `Recent work \\parencite{einstein1905} laid the foundation for special relativity.
\\printbibliography`,
    image: "/package-docs/biblatex.png",
  },
  natbib: {
    description: "Flexible author-year or numeric citation styles (\\citet, \\citep) built on classic bibtex.",
    example: `As shown by \\citet{einstein1905b}, and further explored in \\citep{einstein1905b}.
\\bibliography{refs2}`,
    image: "/package-docs/natbib.png",
  },
  babel: {
    description:
      'Multilingual typesetting — correct hyphenation, quote styles, and localized names ("Section" -> "Section", etc.) per language.',
    example: `\\selectlanguage{french}
Un texte simple en fran\\c{c}ais, avec des guillemets \\guillemotleft{}comme ceci\\guillemotright{}.`,
    image: "/package-docs/babel.png",
  },
  csquotes: {
    description: "Context- and language-sensitive quotation marks (\\enquote) — nesting handled automatically.",
    example: `She said \\enquote{This is a nested \\enquote{quotation} example}, handled automatically.`,
    image: "/package-docs/csquotes.png",
  },
  enumitem: {
    description:
      "Customize list spacing, labels, and indentation per-list, instead of editing LaTeX internals globally.",
    example: `\\begin{itemize}[label=\\textbullet,itemsep=2pt,leftmargin=1.2em]
  \\item Custom bullet and spacing
  \\item Applied per-list, not globally
  \\item Easy to override just once
\\end{itemize}`,
    image: "/package-docs/enumitem.png",
  },
  siunitx: {
    description:
      "Consistent SI unit and number formatting (\\SI{...}{...}) — correct spacing, unit abbreviations, and number formatting.",
    example: `The speed of light is \\SI{2.998e8}{\\meter\\per\\second}.\\\\
A resistor rated \\SI{4.7}{\\kilo\\ohm} at \\SI{25}{\\celsius}.`,
    image: "/package-docs/siunitx.png",
  },
  cleveref: {
    description:
      'Smart cross-references — \\cref automatically prepends "fig."/"table"/"sec." based on what\'s being referenced, instead of a bare number.',
    example: `See \\cref{fig:demo} below --- \\texttt{cleveref} adds \\textit{'fig.'} automatically.
\\begin{figure}[h]\\centering\\includegraphics[width=2cm]{sample.png}\\caption{Demo}\\label{fig:demo}\\end{figure}`,
    image: "/package-docs/cleveref.png",
  },
  todonotes: {
    description:
      "Inline TODO/margin notes visible in the compiled PDF — handy for drafts, easy to strip out later.",
    example: `Body text with an inline note\\todo{Check this claim against the 2023 dataset.} continuing right after.`,
    image: "/package-docs/todonotes.png",
  },
  microtype: {
    description:
      "Subtle micro-typographic refinements (character protrusion, font expansion) that make justified text look more even.",
    example: `Microtype subtly adjusts character spacing and font expansion so justified
text looks more even --- most noticeable in dense, fully-justified
paragraphs like this one, even though the effect is intentionally subtle.`,
    image: "/package-docs/microtype.png",
  },
  fancyhdr: {
    description: "Custom headers and footers — different content on the left/center/right, per page style.",
    example: `\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{My Thesis}
\\fancyhead[R]{\\thepage}
\\fancyfoot[C]{Draft version}
Body text under a custom header and footer.`,
    image: "/package-docs/fancyhdr.png",
  },
  titlesec: {
    description: "Customize section/chapter title formatting — font, color, spacing, numbering style.",
    example: `\\titleformat{\\section}{\\normalfont\\Large\\bfseries\\color{blue!70!black}}{\\thesection}{1em}{}
\\section{Styled Section Heading}
Body text following a custom-styled section heading.`,
    image: "/package-docs/titlesec.png",
  },
  parskip: {
    description: "Paragraph spacing (a blank line's worth of vertical space) instead of a first-line indent.",
    example: `First paragraph, with no first-line indent and visible spacing before the next.

Second paragraph starts here, separated by vertical space instead of an indent.`,
    image: "/package-docs/parskip.png",
  },
  array: {
    description: "Extended column types for tabular (fixed-width p{} columns with custom alignment).",
    example: `\\begin{tabular}{>{\\centering\\arraybackslash}p{2cm} >{\\raggedleft\\arraybackslash}p{2cm}}
\\toprule
Centered & Right \\\\
\\midrule
Text & 123.45 \\\\
\\bottomrule
\\end{tabular}`,
    image: "/package-docs/array.png",
  },
  inputenc: {
    description:
      "Input character encoding declaration (\\usepackage[utf8]{inputenc}) — lets accented/special characters be typed directly in the source.",
    example: `Direct UTF-8 input works out of the box: caf\\'e, na\\"ive, Z\\"urich, and symbols like \\texteuro, \\S, and $\\pm$.`,
    image: "/package-docs/inputenc.png",
  },
};
