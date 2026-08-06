# Before you actually submit this to arXiv

This folder is arXiv-ready in the mechanical sense (real LaTeX source, compiles
clean with `pdflatex`, figures included, no company-specific framing). Two
things to check yourself before submitting, because I can't verify them from
here:

1. **Author block** (`main.tex`, top): name is pulled from your git config,
   affiliation is a placeholder ("Independent Researcher"). arXiv also wants
   an email tied to your account at submission time, not in the PDF itself.

2. **Bibliography** (`main.tex`, `thebibliography` at the bottom): I wrote
   these from what was already established earlier in this project (author
   names, organizations, one-line descriptions), not from a live lookup just
   now. I did not attach exact venues, volume/page numbers, or arXiv IDs I
   couldn't confirm, precisely to avoid inventing citation details that look
   authoritative but aren't. Before submitting, verify each entry (especially
   PBSuite, GovSim, MAST, DeZoort, Braun) resolves to a real, findable source,
   and add proper venue/year/URL once confirmed.

## Rebuilding the PDF

```
pdflatex main.tex
pdflatex main.tex   # second pass, resolves cross-references
cp main.pdf PolicyTown_ArxivReady.pdf
```

## What's different from `report/PolicyTown-Report.pdf`

That version was written for a specific reader (White Circle) and stays as
is. This one: standard paper structure (abstract, intro, related work,
method, results, discussion, limitations, conclusion), no company named as
the audience, expanded related-work paragraphs instead of one-liners, and a
data/code availability statement instead of a company-relevance section.
