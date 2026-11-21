# csv-reader-speed-01-run-20261121 — a faster csv-reader

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Tianchen0012/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Tianchen0012/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

A drop-in replacement for csv-reader 1.0.0 that returns exactly its answers
(`{columns, rows, errors}` for `{text, header}`, broken rows included) and
reads the same text faster.

`solve.js` is a single-pass scanner: plain records are split on commas in
one go, quoted fields are found with `indexOf` and sliced, unquoted fields
are sliced between delimiters, and no field is ever built one character at a
time. `main.ts` is the house baseline's driver, kept as it is (including
`--no-incremental-marking`).

Verified on the kit's practice set: every case identical to the oracle
(kit scorer: 6/6 passed), two runs byte-identical, and 106 hand-built edge
cases match csv-reader 1.0.0 exactly. Speed on this machine, whole driver
end to end, 9 fresh runs each, trimmed mean (drop 2 fastest + 2 slowest):
this entry 0.947 s vs the house baseline 1.932 s — 49% of the baseline.
Independently re-checked by a second session: 6/6 cases identical to the
expected outputs, median of 5 fresh runs 0.755 s vs baseline 1.526 s.
MIT licensed.
