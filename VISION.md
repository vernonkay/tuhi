# tuhi — vision & non-goals

tuhi exists because opening a very large file shouldn't be a special occasion. Most
editors are built for source files of a few hundred kilobytes and treat a multi-GB log
as an error condition. tuhi is built the other way round: large files are the normal
case, and everything else follows from keeping that fast.

## North star

**A fast, cross-platform, plain-text editor that never chokes — the loved parts of
Notepad++, rebuilt portable, modern, and large-file-first.**

Three words we hold ourselves to:

- **Fast.** Open instantly, scroll instantly, stay responsive at any file size. If a
  feature can't keep that promise, it waits until it can.
- **Simple by default.** It should feel obvious on first launch: no setup, no vault, no
  config file required. Power is opt-in, never imposed.
- **Local & plain.** Your files are plain text on your disk. tuhi reads and writes them
  faithfully and gets out of the way. No lock-in, no proprietary store, no cloud
  dependency.

## What tuhi is for

- Reading and searching huge logs, data dumps, exports and minified blobs.
- Everyday text and Markdown editing across Windows, macOS and Linux.
- The quick, trustworthy "just open it" editor you reach for a hundred times a day.

## Non-goals — what tuhi is deliberately *not*

These aren't "not yet", they're choices that keep the north star honest. A request that
pulls against one of these will usually be declined with a pointer back here.

- **Not an IDE.** No language servers, debuggers, build integration, or project-wide
  refactoring. tuhi edits files, it doesn't manage projects.
- **Not a knowledge base / PKM.** No enforced vault, no graph database, no required
  backlink index. Optional `[[wikilinks]]` may exist; a system-of-record will not.
- **Not an extension platform, at least not early.** A large async plugin API is exactly
  the kind of complexity that has sunk ambitious editors before. If plugins ever happen,
  they'll be small, synchronous, and added late and deliberately.
- **Not a collaboration tool.** No real-time co-editing, no CRDTs, no accounts. tuhi is
  a single-user, local editor.
- **Not an AI editor.** No chat panel, no inline completion, no model calls at runtime.
  (tuhi is *built* with AI assistance; that's a tool for making it, not a feature in it.)
- **Not configuration-maximalist.** Sensible defaults over a thousand settings. Every
  option has to earn its place.

## How this doc is used

When we triage feedback, this is the reference for scope and vision decisions.
"Out of scope for now" (`wontfix:scope`) means *maybe later, but not a fit today*. "Not
aligned with the vision" (`wontfix:vision`) means *it pulls against one of the non-goals
above*. Either way you get a real reply explaining which and why, see
[`TRIAGE.md`](TRIAGE.md).

The vision can change, but slowly and in the open. If you think a non-goal is wrong,
that's a great [Discussion](https://github.com/vernonkay/tuhi/discussions).
