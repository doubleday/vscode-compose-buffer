# Path Completion Ranking Specification

This document specifies how Compose Buffer finds, ranks, and displays `@` path
completions. It describes the intended behavior of the implementation in
`src/pathIndex.ts`; changes to that implementation should preserve this contract
or update this document and its examples.

## Goals

The ranking algorithm should be predictable from the structure of a path:

- Exact and structured matches outrank arbitrary character subsequences.
- Camel-case transitions and punctuation define equivalent word boundaries.
- Literal `/` characters express path structure.
- A direct basename match outranks a match inherited only from an ancestor.
- Files win ties between otherwise comparable file and directory results.
- Shorter or earlier matches break ties; they do not override better semantics.

All comparisons are ascending: the first differing rank component decides the
order, and a lower value ranks first.

## Query Modes

The text after `@` selects one of three modes.

| Syntax | Target candidates | Text being matched |
| --- | --- | --- |
| `@query` | Files and directories | Full workspace-relative path |
| `@f:query` | Files only | File basename |
| `@d:query` | Directories only | Directory basename |

Plain path search returns typed results so that directories use a folder icon
and insert a trailing `/`. A trailing slash in a plain query means the user is
continuing inside that directory; the directory itself is therefore omitted
from its own results.

## Normalization

Indexed paths and queries use forward slashes. Surrounding whitespace,
backslashes, and leading slashes are normalized. Indexed paths also discard a
trailing slash; path-mode queries preserve one to represent directory
continuation.

Matching is case-insensitive. Original casing is retained only to discover
camel-case boundaries. Query casing never changes the result:

```text
dpw == DPW
```

## Words and Boundaries

A target is divided into words at:

- `/`, `-`, `_`, and `.` separators;
- a transition from a lowercase letter to an uppercase letter;
- letter and number boundaries recognized by the tokenizer.

Consequently, these names expose the same three semantic words:

```text
differential-pipeline-wrapper
DifferentialPipelineWrapper
Differential/Pipeline/Wrapper

differential | pipeline | wrapper
```

The final file extension is excluded when recognizing word-prefix matches. It
remains part of exact, contiguous, and subsequence matching.

## Match Classes

Each candidate receives the first applicable match class.

### 0. Exact

The normalized query equals the normalized target.

### 1. Structured path

The query contains an internal `/`. Query elements must match consecutive
target path elements; each pair is ranked independently using this same match
class hierarchy.

For each possible alignment, structured ranking prefers:

1. A better worst element match class.
2. A better sum of element match classes.
3. An earlier starting path element.
4. Fewer unmatched target elements after the query.
5. Better individual element ranks, from left to right.

The best alignment becomes the candidate rank. Empty internal query elements
do not match. A trailing slash is ignored for element matching and handled as
directory continuation.

Example:

```text
query: fi/sd/t

first/something-deep/third.md
first/second/third.md
```

Both paths satisfy the three-element structure. `sd` is a word-prefix match for
`something-deep`, but only a general subsequence of `second`, so the first path
ranks higher.

Structured ranking also makes partial folder completion local:

```text
query: openspec/ch

openspec/changes/
openspec/changes/add-login/
openspec/changes/add-login/plan.md
```

The direct folder has no unmatched trailing path elements and ranks first.

### 2. Word prefix

The query can be divided into one or more nonempty pieces, each matching the
prefix of a consecutive target word. The match may begin at any word.

Ranking prefers:

1. More matched words.
2. An earlier starting word.
3. A shorter target.

Examples:

```text
dpw   -> differential | pipeline | wrapper
DiPiW -> differential | pipeline | wrapper
sd    -> something | deep
```

Hyphenated and camel-case spellings receive the same semantic match quality.
Candidate length may break the tie, so `DifferentialPipelineWrapper` ranks
slightly ahead of `differential-pipeline-wrapper`.

### 3. Contiguous substring

The complete query occurs contiguously in the target. Ranking prefers an
earlier occurrence, followed by a shorter target.

### 4. General subsequence

Every query character occurs in order, with arbitrary target characters
between matches. The dynamic search selects the best possible alignment by
preferring:

1. More matched characters at word boundaries.
2. Fewer total skipped characters between matches.
3. An earlier first match.
4. A shorter target.

A character at the beginning of the target or immediately after `/`, `-`, `_`,
or `.` is a boundary match. A lowercase-to-uppercase transition is also a
boundary. Uppercase letters do not receive an independent bonus.

If any query character cannot be found in order, the candidate is excluded.

## Mixed File and Directory Ranking

Plain `@` search evaluates files and directories together. Each candidate has:

- a **full rank** against its workspace-relative path; and
- when possible, a **direct rank** against its basename.

Candidates are ordered by:

1. Direct basename match before ancestor-path-only match.
2. Primary match class and semantic quality. The direct rank is primary when
   present; otherwise the full rank is primary.
3. Full-path match class and semantic quality.
4. File before directory when the preceding evidence is equivalent.
5. Remaining compactness fields from the primary and full ranks.
6. The candidate's stable pre-search order.

This prevents every descendant of a matching directory from burying that
directory:

```text
query: ab

openspec/changes/add-billing/
.images/ab-archive.png
openspec/changes/add-billing/plan.md
openspec/changes/add-billing/proposal.md
```

The directory and image match their basenames directly. The Markdown files
match only through their `add-billing` ancestor. When a file and directory have
equivalent direct matches, the file wins:

```text
add-billing.md
add-billing/
```

File-only and directory-only modes do not need mixed-type or directness rules;
they sort by match rank and then stable pre-search order.

## Stable Ordering and Limits

Index arrays are pre-sorted case-insensitively by their search key and then by
their original value. This index position is the final tie-breaker. Results are
truncated only after ranking. An empty plain query currently returns indexed
files first and then directories, up to the configured completion limit.

VS Code receives a zero-padded `sortText` derived from the final result index,
so it preserves the extension's order.

## Display Rules

The inserted value is always the complete workspace-relative path. Directory
values end in `/`.

The visible label uses the shortest suffix that uniquely identifies the result
within the returned result set. If directory context is shown beside the label,
it is capped at 28 characters and truncated from the beginning so that the most
specific path elements remain visible:

```text
@proposal.md ...nspec/changes/add-billing
```

The path is not repeated as a second inline description.

## Required Examples

Tests should continue to cover at least these behaviors:

- `dpw`, `DPW`, and `DiPiW` across camel-case and hyphenated names.
- `/fi/sd/t` preferring `something-deep` over `second`.
- A structured query rejecting a missing path element.
- `ab` returning direct directory and filename matches before descendants.
- A directly matching file winning a tie with a directly matching directory.
- `openspec/ch` preferring the matching folder over deeper descendants.
- A trailing slash returning directory contents without suggesting the same
  directory again.
- Tail-preserving completion detail truncation.
