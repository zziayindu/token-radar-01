# Token Radar — token-radar-01

A web dashboard that ranks protocols which record no token yet by what their
launch would be worth, each with a farm plan. Built for the make.fun bounty
`token-radar-01`.

## What it does

`main.ts` (Node 22, standard library only) reads the sealed snapshot at
`/input/snapshot.json`, scores every pre-token protocol with the radar-2 model
in `lib/model.ts`, and writes:

- `/output/board.json` — 100 ranked rows: all 40 watchlist protocols, plus the
  60 highest-valued rankable pre-token protocols below the watchlist floor.
- `/output/data.js` — the same board, compact, for the dashboard page.
- `/output/dashboard/` — the static dashboard (no network, no framework).
- `/output/screenshots/` — three screenshots: the board, a detail view, a
  filtered view.
- `/output/dossier.json` — built with the kit's vendored `vendor/makefun-board.ts`.

Run it outside the grader with:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## The model (radar-2)

```
implied = TVL × peer multiple × growth × age × breadth
```

- **Peer multiple**: the median market-cap / TVL of the live-token protocols in
  the same category (at least 3 peers, else the global median), clamped to
  [0.05, 2.00]. Categories the market already values richly give their
  pre-token peers a richer multiple.
- **Growth**: `1 + clamp(change_7d, -50, +100) / 100 × 0.35`. No 7-day change
  recorded counts as 0.
- **Age**: `0.80 + min(age_days, 730) / 730 × 0.20` when `listed_at` is known,
  `0.90` when it is not. Longer without a token counts for more.
- **Breadth**: `1 + min(chains - 1, 3) × 0.02`.

Live-token protocols are never mixed into the board: they appear apart, in the
dashboard's Live market view, at the market's own market cap. Wrapped, staked
and bridged products, exchanges and versioned pools are not rankable — they
wrap a token that already trades.

## Honest labelling

The snapshot is a record, not proof. The board says a protocol *records* no
token, never that it has none: a token may exist that the record does not
carry. Implied values are the model's claim, never a promise — a launch may
be worth more, less, or nothing. Farm plans are a plan, not a promise of an
airdrop.

## Farm plans

Every row carries 6 or 7 steps. Each step states its cost and its time, and each
plan is built from that protocol's own category, chains, TVL and age — never from
a hand-kept list of names. The core action follows the category: lending lends,
a CDP mints its stablecoin against collateral, a DEX adds liquidity, a vault
takes a vault position, a basis trade holds both legs, restaking restakes BTC, a
staking pool stakes the chain's native asset, a card issuer funds the card
account, and so on. Gas is rough and follows the chain's own fee level
(Ethereum mainnet about $5–$15 a transaction, most other chains under $1,
Bitcoin a few dollars of network fees). Steps are a plan, not a promise of an
airdrop.

## Verification (no browser on this VM)

- `node check-dashboard.mjs [out]` — static dashboard check: data.js parses
  and matches board.json, every id app.js reads exists in index.html, every
  sort key the table headers offer exists in the Sort by select, no http(s)
  address in any dashboard file, every model constant app.js reads is in
  data.js.
- `node check-gates.mjs [out]` — the seven sealed-gate rows re-checked locally
  against an /output directory (dashboard files, board, sort order, watchlist
  coverage, farm steps, screenshots, dossier byte-equality via the kit's own
  buildDossier).
- `python3 render-screenshots.py [out]` — draws mock-up screenshots from
  out/board.json in the dashboard's own palette and layout, with a PLACEHOLDER
  banner. Only a fallback: the shipped screenshots are real captures of this
  dashboard in headless Chrome at 1440x800 (board, #1 detail, Risk Curators +
  watchlist filter), taken with /tmp/radar-shoot.mjs over the built output.
- Two runs write byte-identical outputs (verified with diff -r).

## Layout

```
main.ts                  entrypoint
lib/model.ts             the radar-2 model, farm plans, board checks
vendor/makefun-board.ts  the kit's dossier library, byte for byte
dashboard/               index.html, app.css, app.js (static, offline)
screenshots/             1-board.png, 2-detail.png, 3-filtered.png
check-dashboard.mjs      static dashboard verification (no browser)
check-gates.mjs          the seven gate rows, re-checked locally
render-screenshots.py    re-renders the placeholder screenshots from board.json
```

## License

MIT. See `LICENSE`.
