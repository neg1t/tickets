---
name: documentation-writer
description: Use when writing or editing technical documentation from a user-provided draft, reference document, source code, diagrams, or targeted correction prompt. Applies to documentation tasks that require matching an existing doc style, revising a draft before writing, separating user and implementation perspectives, creating Markdown/Mermaid docs, file maps, architecture notes, limitations, and test coverage sections.
---

# Documentation Writer

Write concise technical documentation that matches the user's reference document and is grounded in verified source facts.

Use the language requested by the user. If the user does not specify a language, follow the reference document.

## Workflow

1. Read the user's task fully.
2. Open the reference document supplied by the user.
3. Open the draft supplied by the user, if present.
4. Inspect source files. "Source files" means files explicitly named by the user or explicitly referenced in the draft (imports, file paths, identifiers). Do not chase transitive dependencies unless the user asks.
   - If a required source file is inaccessible (not found, binary, closed repo): stop, report which file is missing and why, and do not write the document until the user resolves the gap.
     **Do not proceed to step 5 until every required source file has been successfully opened.**
5. Compare draft claims against source facts.
6. Write or patch the document only after the style and facts are clear.
7. Run the final checklist (see below). Do not write the response until every item passes.

If the user asks for targeted edits, change only the requested fragments. Do not rewrite whole sections for local wording improvements.

Treat the user's current prompt as authoritative. Reference documents and drafts are supplied per task; do not assume they persist across runs.

## When no reference document is supplied

Apply the quality rules as the style baseline. Prefer tables over bullets, prose over headers where sections are short, and backticks for all identifiers. Note in the final response that no reference was provided.

## Draft revision

When the user asks for draft analysis, put a short block named `## Ревизия черновика` before the document body.

Use up to 6 bullets. Include only findings that change the document — omit observations that require no action. Cover:

- duplicated facts;
- places where user context is mixed with implementation details;
- vague or unverified details that need `[TODO: уточнить из кода]`;
- draft claims contradicted by source facts;
- well-specified details that can be reused directly.

Every finding must be acted on in the document body: either fixed, or marked `[TODO]`. Do not list a finding and then silently ignore it.

## Reference style

Mirror the supplied reference document:

- heading casing and depth;
- density of prose;
- ratio of prose, tables, and diagrams;
- table formatting;
- code-style formatting for paths, names, commands, stores, events, effects, APIs, and config keys;
- use of Mermaid diagrams;
- amount of detail per section.

Do not copy domain facts from the reference unless the user asks for the same domain.

**Priority when reference style conflicts with quality rules:** quality rules win. For example, if the reference uses bullets for every list but quality rules say to prefer tables for parallel structures, use tables.

## Recommended structure

Use this as a menu, not a mandatory template:

1. User-visible behavior.
2. Architecture.
3. Integration or API contract.
4. State model, lifecycle, or data flow.
5. File map.
6. Limitations and extension points.
7. Test coverage.
8. FAQ or migration notes, only when needed.

Drop irrelevant sections. Add domain-specific sections only when the source material requires them. Do not add sections speculatively — every section must be justified by something present in the source, not by what "usually" appears in this kind of document.

### Conditional sections

Some sections are required when the source material contains specific patterns:

- **State model section with a store/effect/event table** — required when the source contains Effector stores, effects, or events.
- **Runtime flow diagram** (sequence or flowchart) — required when the source contains polling, debounce, Gate lifecycle, or multi-step async chains.
- **Extension points subsection inside Limitations** — required when the source contains a registry, factory, or an explicit list of widget/plugin slots.

## Perspective rules

Keep perspectives separated:

- In user-visible sections, describe screens, controls, modes, empty states, loading states, and user outcomes. Do not mention internal store/effect names or file paths.
- In technical sections, describe contracts, layers, effects, stores, queries, events, data mapping, and lifecycle. Do not narrate user behavior unless it is the trigger for a technical flow.
- Pair technical IDs with UI labels when both exist, for example a machine value and the visible label.

## Diagrams

Use diagrams for structure or flow, not for decoration. Do not add a diagram when a table or two sentences cover the same ground — a diagram earns its place only when spatial or temporal relationships cannot be expressed clearly in prose or a table.

- For layered architecture, prefer a structural `flowchart LR` with short node labels. Put details in prose below the diagram.
- For request chains, use a `sequenceDiagram`. Prefer an event/model/effect as the initiating participant when that is the real technical trigger; do not show UI as the only requester unless the code does.
- For state or lifecycle, distinguish real states from pending flags. If the diagram shows "event -> effect -> store", use `flowchart`, not `stateDiagram`.
- Do not restate every arrow in prose. Add only facts that the diagram cannot show cleanly.

## Tables

Use tables for parallel structures:

- modes and visible behavior;
- query or API contract parts;
- store/event/effect responsibilities;
- file maps;
- limitations;
- test coverage.

File maps should usually have two columns: path and role. Keep paths in backticks. Do not restate architectural facts already covered in the Architecture section — file map answers "where is it", not "how it works".

## Fact handling

Trust verified source facts over the draft. If source facts contradict the draft, fix the document and mention the mismatch in the draft revision when relevant.

Use `[TODO: уточнить из кода]` when a fact is required for the document and cannot be verified from available context. Prefer a `[TODO]` over a vague claim that looks authoritative.

Do not invent implementation details, deadlines, owners, APIs, tests, or limitations. If a source file or reference is missing, state the gap briefly.

On re-edits, do not promote an existing `[TODO]` to a confident claim unless the user has explicitly supplied the missing fact. A `[TODO]` that was correct before a patch must remain a `[TODO]` after the patch unless resolved.

## Test coverage section

The test coverage table has three columns: test file, what it covers, and intentional gaps. If a gap is unknown, mark it `[TODO: уточнить намерение]`.

Omit the test coverage section entirely when no test files exist in the source material.

## Quality rules

- No repeated facts. Put each fact in the most specific section.
- No filler phrases: "данный модуль позволяет", "следует отметить", "в целях обеспечения", "необходимо учитывать".
- Use direct declarative sentences.
- Use Markdown only. No HTML and no emojis.
- Put Mermaid in fenced `mermaid` blocks.
- Put code names, paths, commands, environment keys, and identifiers in backticks.
- Use bold only when the reference style uses it.
- Prefer tables over bullet lists for repeated structures.
- Keep diagrams and prose complementary.
- Keep section titles in the reference style.

## Editing existing docs

For a requested patch:

1. Locate the exact section.
2. Patch only the requested text, table rows, or diagram.
3. Preserve surrounding wording unless it becomes factually wrong.
4. Recheck that diagrams parse conceptually and names remain in code style.

For new docs:

1. Draft the outline from the requested structure.
2. Fill each section once.
3. Remove repeated facts during a final pass.
4. Check that unknowns are marked and verified facts are not marked as TODO.

## Final checklist

Run before writing the response. Each item is pass/fail — do not proceed if any item fails.

- [ ] All conditional sections present where source material requires them (state model, runtime flow diagram, extension points)?
- [ ] File map free of facts already stated in the Architecture section?
- [ ] All unverified claims marked `[TODO: уточнить из кода]`?
- [ ] Test coverage table has a gaps column, or section is omitted because no tests exist?
- [ ] No fact repeated across sections?
- [ ] Every draft revision finding reflected in the document (fixed or marked `[TODO]`)?
- [ ] If no reference document was supplied, noted in the response?

## Final response

Report:

- what file changed or was created;
- what kind of change: `new doc` (document did not exist), `patch` (one or more targeted sections changed), `restructure` (sections added, removed, or reordered);
- whether tests or validation were run;
- if no reference document was provided, note it explicitly.

Keep the response short.
