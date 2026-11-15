# `data/service-notice` — service notice setting

**Do not delete. Do not merge into `develop`/`main`.**

This is a standalone [orphan branch](https://git-scm.com/docs/git-switch#Documentation/git-switch.txt---orphan)
that carries **only** the setting for the service notice: the banner the TED Open Data Service
shows below its tabs, on every tab, to tell users about an outage or planned maintenance. It has
no shared history with the application branches on purpose.

## Why a separate branch

The app is a static site served by GitHub Pages from the default branch, so anything in the app
tree can only change through a release. The app reads the notice from this branch when a page
loads instead, so the banner can be switched on, reworded or switched off with a single commit
here, **without releasing the application**.

Raw URL (note the `refs/heads/` prefix, required because the branch name contains a slash):

```
https://raw.githubusercontent.com/OP-TED/ted-open-data/refs/heads/data/service-notice/notice.json
```

## How to use it

Edit `notice.json` on this branch, for example with the pencil icon on GitHub, and commit
directly to the branch.

```json
{
  "show": true,
  "level": "warning",
  "message": "We are experiencing temporary technical issues, so some queries may fail or be slow to respond. We are working to restore the service as soon as possible."
}
```

| Field     | Meaning                                                                                       |
|-----------|-----------------------------------------------------------------------------------------------|
| `show`    | `true` shows the banner. Anything else (`false`, missing, `"true"` as text) hides it.        |
| `level`   | `info` (blue), `warning` (orange) or `error` (red). If missing or unknown, `warning` is used. |
| `message` | The text of the banner, as plain text. HTML is not interpreted. An empty message hides it.   |

- **To switch the banner on**, set `"show": true` and write the message.
- **To switch it off**, set `"show": false`. Leaving the message in place is fine.
- Write messages in British English, short enough to read at a glance, and say what users can
  expect: what is affected and, if known, until when.

## How long a change takes

GitHub caches raw files for about five minutes, so a change reaches users within roughly that
time. Users who already have the page open see it the next time they load the page.

## If something goes wrong

The banner is hidden by default. If this file cannot be fetched, is not valid JSON or does not
say to show, the app shows no banner and otherwise works as normal. So a mistake here can only
hide the banner, never break the site. If the banner does not appear when expected, check that
the file is valid JSON (a trailing comma is the usual culprit) and that `show` is `true` without
quotes.

## Protection

Like every `data/*` branch, this one is covered by the repository ruleset `protect-data-branches`,
which blocks deleting the branch and force-pushing to it. Only people with write access to the
repository can commit here.

The code that reads this file is `src/js/utils/serviceNotice.js` on the application branches.
