# GrammarFix — Dangling-Else Resolver

A self-contained interactive learning project for the classic dangling-`else` ambiguity in context-free grammars.

## Run it

Open `index.html` in a browser, or serve this folder with any static-file server:

```bash
npm start
```

Then visit `http://localhost:4173`.

## What it includes

- An editable nested-conditional input area
- A lightweight parser that enumerates all valid parses for the ambiguous grammar
- Side-by-side visual parse trees
- Matched/unmatched grammar transformation
- A resolved nearest-unmatched-`if` tree and explanation
- Five ready-made test cases and a configurable nesting-depth builder

The input syntax accepts `if (condition)`, action statements ending in `;`, and optional `else` clauses.
