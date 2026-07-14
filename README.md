# `data/exchange-rates` — currency rate data branch

**Do not delete. Do not merge into `develop`/`main`.**

This is a standalone [orphan branch](https://git-scm.com/docs/git-switch#Documentation/git-switch.txt---orphan)
that carries **only** the currency exchange-rate data consumed by the TED Open Data SPARQL
editor at runtime. It has no shared history with the application branches on purpose.

## What lives here

- `exchange-rates.json` — approximate `currency → EUR` rates used by the `currencyconversion`
  autocomplete snippet in the SPARQL editor.

## Why a separate branch

The app is a static site served by GitHub Pages from the default branch, so anything that
ships in the app tree can only change via a release. Serving the rates from this branch lets
them be refreshed by a commit here — **no application release required**. The app fetches the
file at runtime via its raw URL and falls back to the copy bundled in the app if this branch
is unreachable.

Raw URL (note the `refs/heads/` prefix — required because the branch name contains a slash):

```
https://raw.githubusercontent.com/OP-TED/ted-open-data/refs/heads/data/exchange-rates/exchange-rates.json
```

## How it is updated

Intended to be maintained by a scheduled GitHub Actions workflow (defined on `develop`, since
scheduled workflows only run from the default branch) that pulls the European Commission's
official monthly [InforEuro](https://ec.europa.eu/budg/inforeuro/api/public/monthly-rates)
rates, inverts them to `currency → EUR`, filters to the currencies present in the dataset, and
commits back to this branch only when values change.

Until that workflow exists, the file can be refreshed manually from InforEuro (or the
[ECB reference rates](https://www.ecb.europa.eu/stats/eurofxref/) for the major currencies).

See issue [#96](https://github.com/OP-TED/ted-open-data/issues/96).
