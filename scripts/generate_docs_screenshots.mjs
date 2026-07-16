#!/usr/bin/env node
/**
 * Regenerates the real, in-app screenshots used on the docs site
 * (docs/assets/img/*.png, referenced from docs/index.md) — the same
 * throwaway-Playwright-script technique used to verify every feature in
 * this repo, kept around as a real tool instead of being deleted after
 * one use.
 *
 * Requirements:
 *   - The local dev stack running: `docker compose up -d` (this script
 *     talks to the api container by name, `freeleaf-api-1`, and to the web
 *     app at http://localhost:5173 — see API_CONTAINER/WEB_ORIGIN below if
 *     yours differ).
 *   - Playwright, installed locally wherever you run this from (it's
 *     *not* part of the main pnpm workspace — this script is standalone,
 *     same as make_promo_video.py's own self-contained Python):
 *       npm install playwright
 *       npx playwright install chromium
 *
 * Each shot provisions its own throwaway user/project via a Django
 * management-shell one-liner (`docker exec` into the api container),
 * drives the real app through Playwright, screenshots it, and cleans up
 * its own throwaway data afterward.
 *
 * Usage:
 *   node scripts/generate_docs_screenshots.mjs              # every shot
 *   node scripts/generate_docs_screenshots.mjs hero review  # just these
 *   node scripts/generate_docs_screenshots.mjs --list       # list names
 */

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMG_DIR = path.join(REPO_ROOT, "docs", "assets", "img");
const API_CONTAINER = "freeleaf-api-1";
const WEB_ORIGIN = "http://localhost:5173";
const VIEWPORT = { width: 1280, height: 720 };

// ---------------------------------------------------------------------
// Provisioning helpers — same "create a throwaway session via Django
// shell, use it directly as a cookie" trick used throughout this repo's
// own development, since this dev instance's sign-in page requires a real
// SSO/ORCID round trip or a project invite for anonymous/email access.
// ---------------------------------------------------------------------

function djangoShell(pyCode) {
  const escaped = pyCode.replace(/'/g, `'"'"'`);
  return execSync(`docker exec ${API_CONTAINER} python manage.py shell -c '${escaped}'`, {
    encoding: "utf8",
  });
}

let sessionCounter = 0;

/** Creates a throwaway `email`-kind user + a valid Django session for it.
 * Returns `{ sessionid, email }` — `sessionid` hands straight to a
 * Playwright browser context as a cookie; `email` lets a caller look the
 * same user up again later (e.g. to grant a second collaborator
 * Membership on a project created by the first). Tracks created emails so
 * cleanupAll() can remove them again at the end. */
const createdEmails = [];
function createSession(label) {
  sessionCounter += 1;
  const email = `docs-shot-${Date.now()}-${sessionCounter}@example.com`;
  createdEmails.push(email);
  const out = djangoShell(`
from accounts.models import User
from django.contrib.sessions.backends.db import SessionStore
user, _ = User.objects.get_or_create(kind='email', email='${email}', defaults={'display_name': '${label}'})
session = SessionStore()
session['fl_user_id'] = str(user.id)
session.create()
print('SESSIONID=' + session.session_key)
`);
  const match = out.match(/SESSIONID=(\S+)/);
  if (!match) throw new Error(`Could not create a session for ${label}:\n${out}`);
  return { sessionid: match[1], email };
}

/** Grants `email`'s user an editor Membership on the project named
 * `projectName` (matched by name — fine for throwaway single-run demo
 * data). Real collaborator access normally comes through a ShareLink
 * invite; this skips straight to the end state for screenshot purposes. */
function grantMembership(projectName, email, role = "editor") {
  djangoShell(`
from accounts.models import User
from projects.models import Project, Membership
user = User.objects.get(email='${email}')
project = Project.objects.get(name='${projectName}')
Membership.objects.get_or_create(project=project, user=user, defaults={'role': '${role}'})
`);
}

const createdProjectNames = [];
function trackProject(name) {
  createdProjectNames.push(name);
  return name;
}

function cleanupAll() {
  if (createdEmails.length === 0 && createdProjectNames.length === 0) return;
  const emailsPy = JSON.stringify(createdEmails);
  const namesPy = JSON.stringify(createdProjectNames);
  djangoShell(`
from accounts.models import User
from projects.models import Project, Template
User.objects.filter(email__in=${emailsPy}).delete()
Project.objects.filter(name__in=${namesPy}).delete()
print('cleaned up')
`);
}

// ---------------------------------------------------------------------
// Small app-driving helpers shared across shots.
// ---------------------------------------------------------------------

/** `session` is either a plain sessionid string or `createSession()`'s
 * `{ sessionid, email }` return value — accepts both so most call sites
 * can just do `newContext(browser, createSession("Label"))` without
 * unpacking, while flows that also need the email (e.g. granting a second
 * collaborator Membership) can hold onto the full object. */
async function newContext(browser, session) {
  const sessionid = typeof session === "string" ? session : session.sessionid;
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addCookies([{ name: "sessionid", value: sessionid, domain: "localhost", path: "/" }]);
  return context;
}

async function newProject(page, name) {
  trackProject(name);
  await page.goto(`${WEB_ORIGIN}/projects`);
  await page.waitForTimeout(700);
  await page.click("text=New project");
  await page.waitForTimeout(250);
  await page.click("text=Blank");
  await page.waitForTimeout(250);
  await page.locator('input[placeholder="My thesis"]').fill(name);
  await page.click("text=Create");
  await page.waitForURL(/\/projects\/.+/, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.click("text=main.tex");
  await page.waitForSelector(".cm-editor", { timeout: 15000 });
}

async function setDoc(page, text) {
  await page.click(".cm-content");
  await page.keyboard.press("Meta+A");
  await page.keyboard.type(text, { delay: 3 });
}

async function shoot(page, name) {
  await page.screenshot({ path: path.join(IMG_DIR, `${name}.png`) });
  console.log(`  -> ${name}.png`);
}

// ---------------------------------------------------------------------
// Shots. Each is `async (browser) => {}`, fully self-contained.
// ---------------------------------------------------------------------

const shots = {
  async hero(browser) {
    const page = await (await newContext(browser, createSession("Hero Shot"))).newPage();
    await newProject(page, "Rare-Event Detection");
    await setDoc(
      page,
      String.raw`\documentclass{article}
\usepackage{amsmath}
\title{Adaptive Sampling for Rare-Event Detection}
\author{A. Researcher}
\date{\today}
\begin{document}
\maketitle

\section{Introduction}
We study the problem of detecting rare events in large, imbalanced datasets.
Formally, given a distribution $p(x)$, we seek regions where a scoring
function $f$ exceeds a threshold $\tau$:
\[
  \mathcal{R} = \{ x : f(x) > \tau \}.
\]

\section{Method}
Our approach combines importance sampling with an adaptive proposal
distribution $q_t(x)$, updated at every iteration $t$ to concentrate mass
near the current estimate of $\mathcal{R}$.
\end{document}
`,
    );
    await page.click("text=Recompile");
    await page.waitForTimeout(4000);
    await shoot(page, "hero-workspace");
  },

  async collaboration(browser) {
    const sessionA = createSession("Collab A");
    const sessionB = createSession("Collab B");
    const pageA = await (await newContext(browser, sessionA)).newPage();
    await newProject(pageA, "Collab Demo");
    const projectUrl = pageA.url();

    // pageB's user has no Membership on this project yet — real access
    // normally comes through a ShareLink invite; grant it directly here
    // rather than driving that whole UI flow just to get a screenshot.
    grantMembership("Collab Demo", sessionB.email);

    const pageB = await (await newContext(browser, sessionB)).newPage();
    await pageB.goto(projectUrl);
    await pageB.waitForSelector(".cm-editor", { timeout: 15000 });
    await pageB.click("text=main.tex");
    await pageB.waitForTimeout(1000);

    await setDoc(
      pageA,
      String.raw`\documentclass{article}
\begin{document}
\section{Results}
Live edits from both collaborators merge here.
\end{document}
`,
    );
    await pageA.waitForTimeout(1500);
    await pageB.waitForTimeout(1000);
    await pageA.click("text=Recompile");
    await pageA.waitForTimeout(4000);
    await shoot(pageA, "collab-merged-compile");
  },

  async citations(browser) {
    const page = await (await newContext(browser, createSession("Citations"))).newPage();
    await newProject(page, "Citations Demo");
    await setDoc(page, "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n");
    await page.click(".cm-content");
    await page.keyboard.press("Meta+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");

    // Paste-detection only fires on a real clipboard `paste` DOM event, not
    // typed keystrokes — simulate one to seed a library entry.
    const bibtex = "@article{turing1936computable, title={On computable numbers, with an application to the Entscheidungsproblem}, author={Turing, Alan Mathison and others}, journal={J. of Math}, volume={58},  number={345-363}, pages={5}, year={1936},  publisher={Wiley Online Library} }";
    await shoot(page, "cite-before");
    await page.evaluate((bib) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", bib);
      const evt = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector(".cm-content").dispatchEvent(evt);
    }, bibtex);
    await page.waitForTimeout(800);
    await shoot(page, "cite-insert");
    await page.click("text=Library");
    await page.waitForTimeout(500);
    await shoot(page, "cite-library");


  },

  async comments(browser) {
    const page = await (await newContext(browser, createSession("Comments"))).newPage();
    await newProject(page, "Comments Demo");
    await setDoc(
      page,
      String.raw`\documentclass{article}
\begin{document}
This sentence contains a phrase worth commenting on directly.
\end{document}
`,
    );
    await page.waitForTimeout(500);
    // Select "worth commenting on" by character count from line start —
    // exact and monospace-reliable, unlike guessing pixel positions.
    // Line: "This sentence contains a phrase worth commenting on directly."
    //        ^-------------- 32 chars --------------^^--- 19 chars ---^
    const line = page.locator(".cm-line", { hasText: "worth commenting" }).first();
    await line.click();
    await page.keyboard.press("Home");
    for (let i = 0; i < 32; i++) await page.keyboard.press("ArrowRight");
    for (let i = 0; i < 19; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(150);

    // Right-click inside the *selected* range specifically (its midpoint,
    // chars 32-51 of 63 total), not the line's own midpoint — the two
    // aren't the same, and right-clicking outside the selection would just
    // open the browser's default context menu instead of "Add comment".
    const box = await line.boundingBox();
    if (box) await page.mouse.click(box.x + (box.width * 41.5) / 63, box.y + box.height / 2, { button: "right" });
    await page.waitForTimeout(300);
    await page.click("text=Add comment");
    await page.waitForTimeout(300);
    await page.locator("textarea").last().fill("This phrasing is a bit awkward, can we rephrase?");
    await page.click("text=Comment");
    await page.waitForTimeout(500);
    await page.click("text=Recompile");
    await page.waitForTimeout(3000);
    await shoot(page, "comments-marked-text");
  },

  async review(browser) {
    const page = await (await newContext(browser, createSession("Review"))).newPage();
    await newProject(page, "Review Demo");
    await setDoc(
      page,
      String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
This project introduces our method.
\end{document}
`,
    );
    await page.click("text=Recompile");
    await page.waitForTimeout(3000);
    await page.click("text=Reviewing");
    await page.waitForTimeout(400);
    await page.click(".cm-content");
    await page.keyboard.press("Meta+End");
    await page.keyboard.type(" This is a suggested addition from a reviewer.", { delay: 15 });
    await page.waitForTimeout(800);
    const suggestionSpan = page.locator('span[style*="color"]:has-text("reviewer")').last();
    await suggestionSpan.hover();
    await page.waitForSelector(".cm-suggestionTooltip", { timeout: 5000 });
    await page.waitForTimeout(300);
    await shoot(page, "suggested-edit-hover");
  },

  async tables(browser) {
    const page = await (await newContext(browser, createSession("Tables"))).newPage();
    await newProject(page, "Table Designer Test");
    await setDoc(
      page,
      String.raw`\documentclass{article}
\begin{document}
\begin{tabular}{|l|c|}
\hline
Name & Score \\
\hline
Alice & 90 \\
\hline
\end{tabular}
\end{document}
`,
    );
    await page.waitForTimeout(600);
    await page.click('[class*="tableDesignerIcon"]');
    await page.waitForTimeout(500);
    await shoot(page, "table-designer-open");
  },

  async pasteTable(browser) {
    const page = await (await newContext(browser, createSession("Paste Table"))).newPage();
    await newProject(page, "Paste Table Demo");
    await setDoc(page, "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n");
    await page.click(".cm-content");
    await page.keyboard.press("Meta+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    const html = `<table border="0" cellpadding="0" cellspacing="0" width="360" style="border-collapse:collapse;">
<tr><td colspan="3" style="font-weight:bold;text-align:center">Model Comparison</td></tr>
<tr><td style="font-weight:bold">Method</td><td style="font-weight:bold">Accuracy</td><td style="font-weight:bold">Time (s)</td></tr>
<tr><td>Baseline</td><td style="text-align:right">82.1%</td><td style="text-align:right">0.4</td></tr>
<tr><td><i>Ours</i></td><td style="text-align:right;font-weight:bold">91.7%</td><td style="text-align:right">0.6</td></tr>
</table>`;
    await page.evaluate((tableHtml) => {
      const dt = new DataTransfer();
      dt.setData("text/html", tableHtml);
      dt.setData("text/plain", "Model Comparison\nMethod\tAccuracy\tTime (s)");
      const evt = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector(".cm-content").dispatchEvent(evt);
    }, html);
    await page.waitForTimeout(800);
    await page.click("text=Recompile");
    await page.waitForTimeout(4000);
    await shoot(page, "paste-table-compiled");
  },

  async packageDocs(browser) {
    const page = await (await newContext(browser, createSession("Package Docs"))).newPage();
    await newProject(page, "Package Docs Demo");
    await setDoc(
      page,
      String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
Hello
\end{document}
`,
    );
    await page.waitForTimeout(600);
    await page.locator('[class*="packageDocsIcon"]').first().click();
    await page.waitForTimeout(600);
    await shoot(page, "package-docs-open");
  },

  async templates(browser) {
    djangoShell(`
from projects.models import Template
from accounts.models import User
u = User.objects.filter(kind='email').first()
Template.objects.filter(name__in=['Master Thesis','Conference Article (IEEE)','Modern CV']).delete()
Template.objects.create(name='Master Thesis', description='A clean thesis skeleton with chapters, bibliography, and a title page.', source_url='https://github.com/example/thesis-template', category='Thesis', zip_storage_key='templates/demo-thesis.zip', created_by=u, is_published=True)
Template.objects.create(name='Conference Article (IEEE)', description='Two-column IEEE conference paper layout.', source_url='https://github.com/example/ieee-template', category='Article', zip_storage_key='templates/demo-ieee.zip', created_by=u, is_published=True)
Template.objects.create(name='Modern CV', description='A clean, modern one-page CV/resume layout.', source_url='https://github.com/example/cv-template', category='CV', zip_storage_key='templates/demo-cv.zip', created_by=u, is_published=True)
`);
    const page = await (await newContext(browser, createSession("Templates"))).newPage();
    await page.goto(`${WEB_ORIGIN}/projects`);
    await page.waitForTimeout(700);
    await page.click("text=New project");
    await page.waitForTimeout(300);
    await page.click("text=From template");
    await page.waitForTimeout(700);
    await shoot(page, "template-gallery");
    djangoShell(`
from projects.models import Template
Template.objects.filter(name__in=['Master Thesis','Conference Article (IEEE)','Modern CV']).delete()
`);
  },

  async navigation(browser) {
    const page = await (await newContext(browser, createSession("Navigation"))).newPage();
    await newProject(page, "Navigation Demo");
    await setDoc(
      page,
      String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
This project introduces our method.
\subsection{Motivation}
Prior work leaves an important gap unaddressed.
\begin{figure}
\caption{Overview of the pipeline}
\end{figure}
\section{Results}
Our approach improves accuracy substantially.
\end{document}
`,
    );
    await page.waitForTimeout(600);
    await page.click("text=Outline");
    await page.waitForTimeout(500);
    await shoot(page, "sidebar-outline");
  },

  async compileSynctex(browser) {
    const page = await (await newContext(browser, createSession("SyncTeX"))).newPage();
    await newProject(page, "SyncTeX Demo");
    await setDoc(
      page,
      String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
This is the first paragraph, used as the forward-search target line.

This is a second paragraph with more text to give the page some body,
so the highlighted region is easy to see in the screenshot.
\end{document}
`,
    );
    await page.click("text=Recompile");
    await page.waitForTimeout(4000);
    await page.click(".cm-content");
    // Ctrl/Cmd-click the first paragraph's line to trigger forward search.
    const target = page.locator("text=This is the first paragraph").first();
    await target.click({ modifiers: ["Meta"] }).catch(() => target.click({ modifiers: ["Control"] }));
    await page.waitForTimeout(1000);
    await shoot(page, "synctex-forward-search");
  },

  async history(browser) {
    const page = await (await newContext(browser, createSession("Version History"))).newPage();
    // Deliberately doesn't contain "Editor"/"Library"/"Settings"/"History"
    // — those are also the workspace tab labels, and a plain `text=` click
    // would match the *project title* (which also renders that substring)
    // before the actual tab link, same class of bug as the app's own
    // "Fix" button vs. a project literally named "FixIt ...".
    await newProject(page, "Version Notes Demo");
    await setDoc(
      page,
      String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
This project introduces our method.

\section{Related Work}
Prior approaches address this problem only partially.
\end{document}
`,
    );
    await page.waitForTimeout(500);
    const historyTab = page.locator('a[href$="/history"]');
    const editorTab = page.locator('a[href$="/editor"]');
    await historyTab.click();
    await page.waitForTimeout(500);
    await page.click("text=Save a version");
    await page.waitForTimeout(300);
    await page.fill('input[placeholder^="Label"]', "First draft");
    // Exact match — "Save a version" (the still-visible toggle button) also
    // contains the substring "Save" and would otherwise match first,
    // re-closing the form instead of submitting it.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(800);
    await editorTab.click();
    await page.waitForTimeout(300);
    await setDoc(
      page,
      String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
This project introduces our method.

\section{Related Work}
Prior approaches address this problem only partially.

\section{Results}
Our approach improves accuracy substantially over the baseline.
\end{document}
`,
    );
    await page.waitForTimeout(1500);
    await historyTab.click();
    await page.waitForTimeout(500);
    await page.click("text=First draft");
    await page.waitForTimeout(700);
    await shoot(page, "version-history-diff");
  },

  async signin(browser) {
    // CAVEAT: this shot reflects whatever SiteSettings this dev instance
    // currently has (ORCID on/off, magic-link/anonymous invite-gating,
    // which SSO providers are configured) — not necessarily the general
    // product capability the docs copy describes. Check the output against
    // the current login-sso-picker.png before overwriting it; if ORCID is
    // disabled on this instance right now, the real ORCID+SSO login page
    // this docs section is illustrating won't render, and the existing
    // committed image is more representative than a fresh capture.
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.goto(`${WEB_ORIGIN}/login`);
    await page.waitForTimeout(700);
    await shoot(page, "login-sso-picker");
  },
};

// ---------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    console.log(Object.keys(shots).join("\n"));
    return;
  }
  const names = args.length > 0 ? args : Object.keys(shots);
  const unknown = names.filter((n) => !shots[n]);
  if (unknown.length > 0) {
    console.error(`Unknown shot(s): ${unknown.join(", ")}\nRun with --list to see available names.`);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch();
  try {
    for (const name of names) {
      console.log(`\n== ${name} ==`);
      try {
        await shots[name](browser);
      } catch (err) {
        console.error(`  FAILED: ${name}:`, err.message);
      }
    }
  } finally {
    await browser.close();
    cleanupAll();
  }
}

main();
