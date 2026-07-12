---
layout: default
title: FreeLeaf — The LaTeX editor you always wanted but never asked for
description: Open, self-hostable, real-time collaborative LaTeX editing.
---

<section class="hero">
  <h1>🍃 FreeLeaf</h1>
  <p class="tagline">The LaTeX editor you always wanted but never asked for. <span>;-)</span></p>
  <p class="subtagline">
    Open-source, self-hostable, real-time collaborative LaTeX editing — with the parts every
    Overleaf refugee actually asks for: sane sign-in, real comments, track changes, version
    history, and a sandboxed compile pipeline you control.
  </p>
  <div class="cta">
    <a class="button primary" href="https://github.com/{{ site.repository }}">View on GitHub</a>
    <a class="button secondary" href="https://github.com/{{ site.repository }}#readme">Self-hosting guide</a>
  </div>
  <div class="hero-shot">
    <img src="{{ '/assets/img/comments-marked-text.png' | relative_url }}" alt="FreeLeaf editor with a marked-text comment thread open">
  </div>
</section>

<nav class="feature-grid">
  <a href="#sovereignty">Digital sovereignty</a>
  <a href="#collaboration">Real-time collaboration</a>
  <a href="#citations">Citations &amp; references</a>
  <a href="#comments">Comments on marked text</a>
  <a href="#review">Review modes &amp; track changes</a>
  <a href="#tables">Table Designer</a>
  <a href="#compile">Compile &amp; SyncTeX</a>
  <a href="#history">Version history</a>
  <a href="#signin">Flexible sign-in</a>
</nav>

<section class="feature-solo" id="sovereignty">
  <h2>Digital sovereignty, not vendor lock-in</h2>
  <p>
    Self-host it on your own institution's servers and it's genuinely yours: documents,
    database, and object storage all live under your own infrastructure and jurisdiction —
    not a third party's cloud, terms of service, or pricing changes. No account required to
    read your data, no dependency on someone else's roadmap or uptime. Point it at your own
    domain and SSO, and your research stays under your own control end to end.
  </p>
</section>

<section class="feature" id="collaboration">
  <div class="feature-text">
    <h2>Real-time collaboration, offline-friendly</h2>
    <p>
      Multiple authors edit the same document at once over a CRDT-backed (Yjs) editor —
      live cursors, presence, and merges that just work, including edits made while
      offline. No "who has the lock" dance, no lost paragraphs.
    </p>
  </div>
  <div class="feature-shot">
    <img src="{{ '/assets/img/collab-merged-compile.png' | relative_url }}" alt="Two collaborators' edits merged automatically, including a change made while one was offline">
  </div>
</section>

<section class="feature reverse" id="citations">
  <div class="feature-text">
    <h2>Citations and references that autocomplete</h2>
    <p>
      Paste BibTeX straight into the editor and it lands in your library automatically,
      with near-duplicate detection so you don't end up with three copies of the same
      entry. <code>\cite{</code> and <code>\ref{</code> autocomplete against your actual
      bibliography and labels — and selecting one closes the brace for you.
    </p>
  </div>
  <div class="feature-shot">
    <img src="{{ '/assets/img/cite-autocomplete.png' | relative_url }}" alt="Citation autocomplete popup while typing \cite{">
  </div>
</section>

<section class="feature" id="comments">
  <div class="feature-text">
    <h2>Comments, attached to exactly the text they're about</h2>
    <p>
      Select a phrase, right-click, <strong>Add comment</strong> — the marked text stays
      highlighted in the editor and quoted in the thread, so nobody has to guess what
      "line 42" meant three revisions later. Reply, resolve, and reopen, all without
      leaving the editor.
    </p>
  </div>
  <div class="feature-shot">
    <img src="{{ '/assets/img/comments-marked-text.png' | relative_url }}" alt="A comment thread quoting the exact marked phrase, highlighted in the editor">
  </div>
</section>

<section class="feature reverse" id="review">
  <div class="feature-text">
    <h2>Writing, Reviewing, and Polishing modes</h2>
    <p>
      Switch into Reviewing mode to see insertions and deletions marked up inline against
      any saved baseline — green underlines, red strikethrough, no separate diff tool.
      Polishing mode aggressively surfaces LaTeX lint: missing non-breaking spaces before
      citations, orphaned headings, unescaped symbols.
    </p>
  </div>
  <div class="feature-shot">
    <img src="{{ '/assets/img/track-changes-markup.png' | relative_url }}" alt="Reviewing mode showing inline insertion and deletion markup against a saved baseline">
  </div>
</section>

<section class="feature" id="tables">
  <div class="feature-text">
    <h2>Table Designer</h2>
    <p>
      A gutter icon appears on every <code>\begin{tabular}</code> line — click it for a
      spreadsheet-like grid editor for cell text, column alignment, and borders. Saves back
      to clean LaTeX. Anything outside its scope
      (<code>\multicolumn</code>, nested tables, booktabs rules) is left untouched with a
      clear message, never silently mangled.
    </p>
  </div>
  <div class="feature-shot">
    <img src="{{ '/assets/img/table-designer-open.png' | relative_url }}" alt="Table Designer dialog editing a tabular environment's cells, alignment, and borders">
  </div>
</section>

<section class="feature reverse" id="compile">
  <div class="feature-text">
    <h2>Sandboxed compiling, with real SyncTeX</h2>
    <p>
      pdflatex and xelatex run in an isolated, network-disabled, non-root sandbox — no
      <code>\write18</code>, no surprises. <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>-click in the PDF
      jumps straight to the matching source line, and vice versa.
    </p>
  </div>
  <div class="feature-shot">
    <img src="{{ '/assets/img/synctex-forward-search.png' | relative_url }}" alt="Forward SyncTeX search highlighting the matching location in the compiled PDF">
  </div>
</section>

<section class="feature" id="history">
  <div class="feature-text">
    <h2>Version history you can actually read</h2>
    <p>
      Automatic checkpoints every few minutes of activity, plus named versions for
      milestones like "Draft sent to advisor." Time Travel shows a real side-by-side diff
      before you commit to restoring anything.
    </p>
  </div>
  <div class="feature-shot">
    <img src="{{ '/assets/img/version-history-diff.png' | relative_url }}" alt="Side-by-side diff between a named version and the current document">
  </div>
</section>

<section class="feature reverse" id="signin">
  <div class="feature-text">
    <h2>Sign in the way your institution already works</h2>
    <p>
      ORCID, magic-link email, and anonymous contributor access out of the box — plus a
      multi-tenant institutional SSO picker for SAML/Shibboleth and LDAP/Active Directory,
      so one FreeLeaf deployment can serve many universities at once.
    </p>
  </div>
  <div class="feature-shot">
    <img src="{{ '/assets/img/login-sso-picker.png' | relative_url }}" alt="Sign-in page with ORCID and an institutional SSO picker">
  </div>
</section>
