# Tuhi, brand v1 (draft, for iteration)

_First concept, 2026-10-19. Nothing here is final; it's a starting point to react to._

## The idea

**Tuhi** means *to write / inscribe / record.* The brand should feel like the name: calm, confident, unfussy, and about the act of writing, not about features. The product promise is "fast, simple, cross-platform, writes plain text and Markdown beautifully", so the identity should read modern and light, never busy or corporate.

**On the Māori connection:** the meaning lives in the *name and its story*, used respectfully. The *visual* identity is deliberately abstract and typographic (a caret and a line), and does **not** borrow tā moko, koru or other Māori design motifs, which would be appropriation. The word carries the heritage; the logo does not imitate the art form.

## Logomark

A **caret over a written line**: `brand/tuhi-logo.svg`.
- The caret `^` is both the editor's insertion cursor and the proof-reader's "insert / write here" mark, so it literally means *write*.
- The line beneath is a line of text, the ink the caret is about to add.
- It reads at small sizes, works as a square app icon (just the mark), and pairs with the wordmark for the full lockup.

## Wordmark

`tuhi`, lowercase, in a clean humanist/geometric sans, tight letter-spacing. Lowercase keeps it friendly and tool-like (vim, zed, micro), not corporate. (The draft uses a system sans; the final wordmark should be outlined to paths so it renders identically everywhere.)

## Palette

| Token | Hex | Use |
|---|---|---|
| Ink | `#15181E` | Primary text, wordmark, the written line |
| Paper | `#FBFAF7` | Light background |
| Tuhi Blue | `#3D6DF6` | Signature accent, the caret, "digital ink" |
| Slate | `#8A8F98` | Secondary text, dividers |
| (alt accent) Coral | `#FF5A3C` | Optional warmer accent direction to consider |

Deliberately **not** DataTorque green, this is Vernon's own project. The story is "ink": an ink-dark primary with a single vivid "digital ink" accent. Coral is offered as a warmer alternative if blue feels too techie.

## Typography

- **UI + wordmark:** Inter (or a similar humanist sans).
- **Editor + code:** a good monospace, e.g. JetBrains Mono or IBM Plex Mono, fitting for an editor.

## Voice

Plain, direct, a bit Kiwi-understated. "Just write." No marketing gloss, no exclamation marks, no emoji in the product.

## Still open / to do
- React to the mark and the accent (blue vs coral), then lock one.
- Outline the wordmark to paths; produce light + dark variants.
- Generate the app icon set (`.ico`, `.icns`, PNGs) and favicon from the final mark.
- A one-line tagline, if we want one (candidates: "Just write." / "A place to write.").
