# Chaos Catalog: project rules

- **Keep `DESIGN.md` current.** Whenever a decision changes the design (a new or dropped feature, a changed data model,
  a new data source, a resolved open question, a phase reordered), update `DESIGN.md` in the same commit as the change.
  Record verified facts in "Verified facts" with the date, and move items out of "Still open" once they're settled.
  If code and `DESIGN.md` disagree, fix whichever is wrong rather than leaving both.
- This is a personal project, separate from work tooling: never copy or reference it in `~/.claude`.
- Be gentle with the data sources (YGOPRODeck, TCGCSV); their rules are in `README.md` "Card data and prices".
