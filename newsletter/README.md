# Newsletter Tool

A writing assistant for the Docent newsletter. Does NOT write the newsletter — helps compile material, suggests structure, and enforces style.

## Directory Structure

```
newsletter/
├── samples/          # Past newsletters or writing samples (voice reference)
├── references/       # Compiled material per issue
│   └── YYYY-MM-DD/   # One folder per issue
└── STYLE.md          # Writing guidelines
```

## How to Use

### 1. Compile References

Ask me to compile material for an issue. I'll create a folder in `references/` with:

- **quotes.md** — Relevant quotes from artists, critics, writers
- **links.md** — Articles, essays, videos worth referencing or linking
- **images.md** — Image suggestions with captions and attribution notes
- **books.md** — Book recommendations with brief context
- **people.md** — Writers, artists, filmmakers relevant to the theme
- **notes.md** — Loose ideas, observations, fragments

Example: "compile references for a newsletter about looking slowly"

### 2. Suggest an Outline

I'll propose a structure — sections, flow, rough word counts — but won't write the body. You write it.

Example output:
```
## Outline: Looking Slowly

1. Opening image/moment (100 words)
   - Anchor with a specific experience or artwork
2. The idea (200 words)
   - What does it mean to look slowly? Why now?
3. A reference (150 words)
   - Quote or cite a writer/artist who speaks to this
4. Connection to Docent (100 words)
   - How this relates to what we're building
5. Closing — one sentence, no summary
```

### 3. Style Check

Paste a draft and I'll flag violations of the style guide (see STYLE.md). I won't rewrite — I'll point to the problem and let you fix it.

### 4. Voice Matching

I read everything in `samples/` to understand your voice. When suggesting outlines or flagging style, I reference your actual writing patterns — not generic "newsletter best practices."

Add your past newsletters or writing samples to `newsletter/samples/` as `.md` files.
