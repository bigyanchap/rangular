# The Rangular Playbook

How work on the Rangular framework gets done, for human contributors and AI coding agents alike.

## Context: what Rangular is

Rangular is a standalone open source framework and transpiler. You write Angular style code: TypeScript classes with `@Component` decorators, HTML like templates, dependency injection, and services. Rangular compiles that code to React Native `.tsx`, which runs as a real mobile app through the standard React Native toolchain, Expo and Metro, with Hermes making the bytecode. Rangular does not fork Angular, and it is not React: source code is Angular in shape, output code is React Native, and the output is generated, never hand edited.

Rangular is a deliberate subset of Angular, not all of it. Simple template blocks compile to pre polished Rangular Material primitives driven by design tokens. Every capability the framework supports is listed in a generated catalog, `catalog.md` and `catalog.json` at the repository root. Every unsupported or partly supported construct produces a named diagnostic code with a concrete fix suggestion, instead of broken output. The framework ships with a CLI, a compiler, a runtime, a UI primitive library, tiny single capability examples with recipe cards, and a companion tutorial app that teaches the whole surface with live demos.

## Context: what this document is for

This document is the working manual for contributing to Rangular. It answers one question: when you sit down to change this framework, how do you work so the change is correct, proved, and easy for the next contributor to trust?

It exists because a compiler has a special failure mode. A small mistake in code generation does not break one screen. It breaks every app generated after it, and it can break them silently, with code that looks right and fails only on a device. It also exists because this framework is built in the open, by people and by AI coding agents working in many separate sessions. Quality cannot depend on who did the work, or on what one session happened to remember. It has to depend on a shared, written routine that anyone can follow and anyone can check.

So this playbook turns the project standard into named routines, called playbooks, one for each common kind of work: adding a feature, fixing a bug, refactoring, investigating a question, improving performance, checking visual parity, evaluating the whole framework, shipping a change, prototyping an idea, pausing and resuming work, cleaning up branches, and writing the documentation and skills that teach future contributors. Each playbook is a short ordered checklist, with a clear statement of what done means. Follow the checklist, and the evidence your work produces (test counts, generated files, screenshots, bundled apps) speaks for itself.

Read this document if you are about to open an issue or a pull request, fix a bug, add a capability, review a change, or direct an AI agent to work in this repository. If you use an AI agent here, point it at this file and at `AGENTS.md` before it writes any code, and ask it to name the playbook it is following.

## What this document is not

This playbook is a guide to how work is done. It is not a reference for what the framework can do, and it does not replace the other documents in this repository:

* To learn what you may write in Rangular source, read the generated catalog, `catalog.md`, and the delta tables in `docs/AI_GUIDE.md`, which state exactly how Rangular differs from Angular and from React.
* To learn how the framework itself is designed, read `docs/BLOCK_DIAGRAM.md` and `docs/PINPOINT_MAP.md`.
* To learn how generated UI stays polished, read `docs/UI_POLISH.md`.
* To learn Rangular as a user, work through the examples in `examples/`, each with its recipe card, and the tutorial app in the `rangular-tutorial` repository.
* For the rules an AI agent must obey in this repository, including the golden rules, read `AGENTS.md`. This playbook explains the routines behind those rules. Where the two disagree, `AGENTS.md` wins for agent behaviour, and this playbook should be corrected to match.

In short: the catalog tells you what exists, the design docs tell you why it is built this way, and this playbook tells you how to change it safely.

## The standard this playbook enforces

A framework like this lives or dies by proof. A change is not done when it compiles. It is done when its tests pass, its examples regenerate, its catalog is fresh, and a real app built with it renders and works at phone size.

The routines are deliberately small. Most steps cost nothing but discipline, and they save far more time than they take, because they catch defects where they are cheapest: before a release, before a device test, before a user finds them.

## How to use this playbook

Before any task, name the playbook in your first message, commit message, or pull request description. Open its steps as a todo list. State the smallest change that meets the goal, and the check that will prove it.

The playbooks are: Feature, Bug Fix, Refactoring, Investigation, Perf Hillclimb, Visual Parity, Eval by Tutorial, Shipping, Prototype, Pause and Pickup, Branch Cleanup, and Authoring a Skill.

If a task fits two playbooks, run Investigation first, then start the second playbook as a separate piece of work.

## Principles

These principles sit under every playbook. When two principles conflict, the earlier one in this list wins.

1. Prove it on the real artifact. Generated code, a bundled app, and a rendered screen are proof. A type check or a compile pass alone is not.
2. Fix root causes. Trace a symptom to the first place the system went wrong and fix it there.
3. Sequence verifiable units. Break work into small units that each end in a check, and verify each unit before starting the next.
4. Test behaviour, not implementation. Assert what a user of the framework can observe, so tests survive refactors.
5. Bias to deletion and the smallest change that solves the problem. Less code is less surface to break, verify, and maintain.
6. Subtract before you add. Remove dead code and needless wrappers first, then build on the simpler base.
7. Build the lever before the feature. A test harness, a generator, or a check that proves the work is worth building first, because every later change reuses it.
8. Attack the premise after two failed fixes. If two attempts fail the same gate, the shared assumption is probably wrong. Write it down and test it directly.
9. Make illegal states unrepresentable. Use types and named diagnostics so invalid code fails loudly at compile time. Never drop a source construct silently: every construct gets a visible effect or a named diagnostic code.
10. Encode lessons in structure. A lesson written as a lint, a guard test, a diagnostic with a fix suggestion, or a recipe card will be obeyed every time. A lesson left in chat or in a commit message will be forgotten.
11. Explain every number with its method. A speed, size, or count claim needs the measurement that produced it.
12. Guard the context. Keep summaries, not raw dumps, in the main thread of work. Route bulk reading to a separate pass and bring back only what a decision needs.

## The tutorial app is the integration test

The companion tutorial app, in the `rangular-tutorial` repository, is the living integration test for this framework. It is not a side project. It teaches Rangular by using Rangular, with a live demo for every capability in the catalog.

That makes it a strict test. If a compiler change breaks a capability, a lesson that teaches that capability breaks. If a new capability ships without a lesson, nobody can learn it, and nothing proves it works in a real app.

Run the tutorial test after any compiler, runtime, UI, catalog, or docs change that affects the public surface:

1. The tutorial compiles with zero diagnostics.
2. The doctor reports clean.
3. The Android bundle builds end to end.
4. The web build exports clean.
5. The web build renders and works in a browser in phone mode, as described in the next section.
6. Home, search, bookmarks, and a sample of lessons open and work. Test at least one simple lesson, one lesson with an interactive demo such as a tap or a toggle, and the capstone lesson.

Classify every failure before fixing it. If the problem is in the tutorial app, fix the tutorial app. If the problem is in the framework, fix this repository. Treat a tutorial failure as a framework failure until it is proved to be tutorial only, because the tutorial only uses documented framework surface.

A new capability is not done until a tutorial lesson for it exists, or an existing lesson is updated to cover it, in the same wave of work. This sits beside the standing rule for this repository: no capability ships without a tiny example, a recipe card, catalog regeneration, and tests in the same commit.

## Verify in a browser in phone mode

Compiling is not seeing. A bundle pass is not seeing. Work that changes what a user sees must be seen, at phone size, in a browser.

Any contributor or agent can run this check:

1. Export the web build of the tutorial app, or start it with `npx expo start --web`, and serve it on a local port.
2. Open it in a browser set to a phone viewport. The primary test size is 375 by 812. A second useful size is 390 by 844. In a desktop browser, open the device toolbar and pick a phone size. For automated runs, use a headless browser on the same machine as the server, for example Playwright with Chromium, set to the same viewport, so the local server is reachable.
3. Capture a screenshot of the first screen.
4. Activate the main entry action, then open the sampled lessons. Activate the live demo in each lesson and confirm it responds as the lesson describes.
5. At phone width, check for blank screens, cut off text, dead controls, and overlap that blocks a tap. Every control on screen must do something real.
6. Save the screenshots with the run report, pull request, or release notes. A phone mode pass claim without screenshots is not a pass.

A browser check does not replace a real device check before a release. It catches layout, rendering, and interaction defects early, on any machine, without hardware. Device review remains the final word on look and feel.

## Playbook 1: Feature

For a new tag, directive, service, or UI capability.

1. Read the official Angular documentation for the exact capability. Name the Angular contract and the data shape first.
2. Write the failing test first. Assert behaviour a user of the framework can observe.
3. List every source construct in scope. Decide a visible effect or a named diagnostic for each one. No silent drops.
4. Build compiler support, then the runtime primitive, then preview support, all from one shared definition where a preview exists.
5. Add the tiny example and its recipe card. Regenerate the catalog. Add or update the tutorial lesson. All in the same commit or pull request.
6. Run the full test suite and report the pass count.
7. Run the tutorial test, including the browser in phone mode check.

Done means: tests green, catalog fresh, tutorial green in phone mode, and a list of what was deliberately left out, and why, is stated in the report.

## Playbook 2: Bug Fix

For a compiler, runtime, CLI, or tutorial bug.

1. Create a minimal reproduction first, and keep it failing. For a tutorial bug, the failing lesson itself can be the reproduction.
2. Name the first wrong place: parser, code generation, runtime, CLI, tutorial app, or docs.
3. If two fixes fail the same gate, stop fixing. Write the shared premise down and test the premise directly.
4. Fix only the first wrong place, with the smallest change that solves the problem.
5. Show runtime evidence. The reproduction now passes, the bundle builds, and, for visible bugs, the browser in phone mode check shows the fix. Unit tests alone are not runtime evidence.
6. Turn the reproduction into a regression test named for the bug. Run the full suite. Run the tutorial test if the bug touched the public surface.
7. Name the gate that missed this bug, and add that gate to this playbook, to a test, or to a skill or checklist, so the lesson lives in structure.

Done means: reproduction fixed with runtime evidence, regression test green, and the missed gate written down.

## Playbook 3: Refactoring

For structure changes with no behaviour change.

1. Freeze behaviour with golden outputs and a full suite baseline first.
2. State what structure changes and what behaviour must not change.
3. Work in small verifiable units. After each unit, tests and goldens stay green, or a golden change is intended and named in that unit.
4. Subtract before you add. Delete dead code and single caller wrappers first.
5. Migrate callers, then delete the legacy API in the same wave. Do not leave a throwaway compatibility layer behind.

Done means: same behaviour, simpler structure, tutorial test still green.

## Playbook 4: Investigation

For how and why questions.

1. Read only. Make no edits in this playbook.
2. Answer from the record: code, catalog, diagnostics list, recipe cards, tutorial lessons, git history, and docs. Cite the source for each claim.
3. Separate confirmed facts, inferences, and open questions.
4. End with a recommendation for which playbook should run next. Do not start it in the same run.

Done means: a cited answer a reader can trust without re-reading the code.

## Playbook 5: Perf Hillclimb

For speed or size work.

1. Pick one metric only: compile time, bundle size, scaffold start time, or tutorial web load time in phone mode.
2. Measure the baseline. State the number, the method, and what limits it.
3. Make one change aimed at that metric. Measure again with the same method.
4. Keep the change only if the metric improves. Discard it if it does not, even if the code looks nicer.
5. Use one commit per accepted win, with the number in the commit message.

Done means: a measured improvement, or a discarded attempt with its number recorded. No performance claim stands without a number and its method.

## Playbook 6: Visual Parity

For UI primitives, the preview renderer, and tutorial screens.

1. Name the source of truth for the visual: the relevant Angular Material behaviour, the UI polish system in `docs/UI_POLISH.md`, or an approved screenshot.
2. Build the preview and the generated code from one shared definition.
3. Compare preview output and generated output for the same input. Treat any difference as a bug in the shared definition.
4. Run the browser in phone mode check at both phone sizes. Save screenshots.
5. Use the smallest effective adjustment that removes an overlap or drift, and apply it consistently across the surface, not only on the screen that was reported.

Done means: parity holds in code, phone mode screenshots are saved, and a human device review is recorded before release.

## Playbook 7: Eval by Tutorial

The tutorial test, run on its own as an evaluation of the whole framework.

1. Run the full tutorial test: zero diagnostics, doctor clean, Android bundle, web export, browser in phone mode.
2. Sample lessons across the whole surface, not only the area that changed: a binding lesson, an events lesson, a list lesson, a routing lesson, a form lesson, a Material lesson, and the capstone.
3. Use the interactive fields and toggles in the sampled lessons. Every control must do something real.
4. Classify any failure with the rule in the tutorial section above, then fix it with the Bug Fix playbook in the right repository.
5. Turn any failure found this way into a permanent test: a regression test, a tutorial lesson check, or both, so the evaluation set grows from real failures.

Done means: tutorial green in phone mode, with the sample list and screenshots in the report.

## Playbook 8: Shipping

For landing a change in either repository.

1. State the plan and the branch or pull request before building. For large changes, discuss the plan in an issue or pull request first and get a maintainer agreement before writing code. Keep changes small enough to review in one pass.
2. Run the delivery gate on the exact content that will land: parser or type checker on every touched file, full test suite, catalog freshness, binary asset checks for images or sounds, and a walk of null and error paths, not only the happy path.
3. Verify after landing, not only before. Read the landed files back from the branch and confirm the decisive content is present. A report of success without a read back is not delivery.
4. Verify platform bundles separately where a bundle is involved. Android and iOS packaging rules differ, and a tutorial change also needs the web export.
5. Report what landed, the test pass count, the read back verification, the tutorial test result, and the deliberate left behind list. Name what still needs a device test or a maintainer review.

Done means: verified delivery that a maintainer has reviewed and merged. Generated files are never edited by hand, and the catalog is never edited by hand: both are regenerated.

## Playbook 9: Prototype

For risky or novel ideas.

1. State the one question the prototype must answer.
2. Build the smallest throwaway version that answers it, in its own folder or worktree, clearly named as throwaway.
3. Compare two or three competing shapes only when the decision is hard to reverse.
4. Record the verdict, and what was rejected and why. Delete or archive the prototype. Prototype code must not drift into the framework.

Done means: a decision with evidence, not a half built feature.

## Playbook 10: Pause and Pickup

For work that spans sessions, contributors, or agents.

Pause, at the end of a work session:

1. Write the state down where the next person will find it: repository, branch, last commit, what is done, what is next in order, what is blocked and on whom, and what was left behind and why.
2. List unpushed work, pending reviews, current test counts, and the last tutorial test result with its screenshots.
3. Name the exact first step for pickup.

Pickup, at the start of the next session:

1. Read the pause state first. Fetch the branch and compare it with the pause state before trusting either.
2. Adopt any commit another contributor made, untouched. Re-run the tests against the fetched state.
3. Restate the goal and the next step before proceeding.

Done means: a new session, human or agent, can continue without guessing and without overwriting anyone else work.

## Playbook 11: Branch Cleanup

1. List all branches with their state: merged, awaiting review, awaiting device test, redundant, or abandoned.
2. Propose deletions in the open, in an issue or pull request comment. Delete nothing that another contributor may still need without their agreement.
3. Keep one bug on one branch. Follow on work for the same fix goes into the same unmerged branch, so reviewers never face stacked merge conflicts for one fix.

Done means: a clean branch list that any contributor can act on in one pass.

## Playbook 12: Authoring a Skill

For a new agent skill, a recipe card, or a change to the AI layer in `docs/AI_GUIDE.md`, `AGENTS.md`, or `llms.txt`.

1. Keep only prose that changes a decision. When in doubt, delete.
2. Validate the result: names, descriptions, referenced files, and links all check out. Add a test case if the skill is structural.
3. Update `llms.txt`, the catalog, recipe cards, and the tutorial lesson in the same wave, if the change affects what a future reader or agent can discover.
4. Ship it with the Shipping playbook.

Done means: a fresh session, given only the docs and the catalog, behaves better because the skill exists, proved by a small test or example. The standing proof test for this repository is a fresh session building a profile screen, avatar, name, a follow button that toggles to Following, and a list of three posts, from the docs alone, compiling clean and toggling in the preview. Any guess that session has to make is a docs failure to fix in the docs.

## A note on cost, for AI assisted work

The cheap steps in this playbook, naming the playbook, a reproduction first, the tutorial test, phone mode screenshots, and pause notes, should run always. They cost little and they prevent the most expensive outcome in software: rework after a defect reaches a user.

Expensive steps, such as parallel attempts at one design or a dedicated adversarial review pass whose only job is to break a change, should run rarely: on a hard compiler decision, a risky migration, or a release candidate. They multiply compute cost by the number of parallel runs, so spend them where a missed defect would cost more than the review.

## Contributing with this playbook

Contributors are welcome to use any playbook here, to propose a new one, or to propose a shorter version of an existing one, through an issue or a pull request. A playbook earns its place the same way a capability does: it must change a real decision, it must be proved on real work, and it must be written down where the next contributor will find it. That is this file.
