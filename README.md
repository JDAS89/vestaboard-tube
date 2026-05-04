# vestaboard-tube

Posts London Tube status and weather to a Vestaboard every 15 minutes via GitHub Actions. Only posts when the content has changed since the last run.

## Normal output format

```
MON 4 MAY 2026
16 C | CLOUD

{66}PICC GOOD
{66}DIST GOOD
{66}HAMM GOOD
```

Row 3 is blank. Rows 4–6 are prefixed with a colour code: `{66}` green, `{65}` yellow, `{64}` orange, `{63}` red.

## Using overrides

You can push any message to the Vestaboard by editing `override.txt` in the repo root. While the file has content, the normal tube/weather logic is skipped entirely.

### How to use

1. Edit `override.txt` — write your message, one row per line
2. Commit and push
3. Wait up to 15 minutes for the next scheduled run (or trigger manually via the Actions tab)

### Layout rules

- Maximum **6 rows**, **22 characters per row** (colour codes like `{66}` count toward the 22)
- Leave a line blank to insert an empty row
- Content is sent verbatim — no automatic padding or truncation

### Colour codes

| Code | Colour |
|------|--------|
| `{66}` | Green |
| `{65}` | Yellow |
| `{64}` | Orange |
| `{63}` | Red |

Place the code at the start of a line to colour that row, e.g. `{63}URGENT MESSAGE`.

### How to revert to normal

Clear the contents of `override.txt` (leave the file empty), commit, and push. The next run will resume normal tube/weather output — and will always post it, even if the normal content matches what was showing before the override.

### Editing from your phone

`override.txt` can be edited directly in the GitHub mobile app:

1. Open the repo → tap `override.txt` → tap the pencil icon
2. Edit the content, scroll down, tap **Commit changes**
3. Done — the next scheduled run will pick it up

### Worked example — dinner menu

```
{65}TONIGHTS MENU

{66}STARTER
BUTTERNUT SOUP
{66}MAIN
ROAST CHICKEN
```

To clear it afterwards, open `override.txt` in GitHub, delete all the text, and commit.

## Setup

### 1. Add the secret

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|------|-------|
| `VESTABOARD_KEY` | Your Vestaboard read/write key |

### 2. Trigger a test run

**GitHub UI:** Actions tab → "Post to Vestaboard" → Run workflow

**GitHub CLI:**
```sh
gh workflow run post.yml
```

The workflow also runs automatically on the cron schedule (`*/15 * * * *`).

## Quiet hours

There are two independent quiet-hours mechanisms, and they work at different levels:

| | `quiet_hours.txt` (this script) | Vestaboard app / dashboard |
|---|---|---|
| **What it does** | Stops the script from running at all | Rejects POST requests to the board |
| **Saves API calls** | Yes | No — the script still runs |
| **Protects the board from all automation** | No | Yes |

It is recommended to set both to the same window. The script handles each gracefully:
- If the script's own quiet hours are active, it exits immediately and logs clearly — no weather or tube data is fetched.
- If the Vestaboard's quiet hours reject a POST, the script logs the rejection and exits cleanly with a success status (no red ✗ in GitHub Actions). `last_message.txt` is not updated so the post will be retried on the next run after quiet hours end.

### Setting the script's quiet hours

Edit `quiet_hours.txt` in the repo root. The file must contain a single line in `HH:MM-HH:MM` format (24-hour, London time):

```
23:00-07:00
```

This means the script will skip all runs between 11 pm and 7 am. Ranges that span midnight work correctly. To disable, clear the file (leave it empty).

**Example — overnight:**
```
23:00-07:30
```

Edit via the GitHub mobile app (tap the file → pencil icon → commit) or commit and push from your terminal. Changes take effect on the next scheduled run.

## Manual updates from the Vestaboard app

You can push any message directly via the Vestaboard app, web dashboard, or any other API client. However, **the script compares the new message against the actual live board state**, so if the script wants to display different content it will overwrite whatever is on the board within 15 minutes.

This means:

- **Quick demos are fine** — show something to a friend via the app, then within 15 minutes the board returns to normal automatically.
- **Sustained custom messages** (dinner menu, party mode, event info) should use `override.txt` instead. That tells the script what you *want* displayed, so it won't fight with you.

If you post via the app and the next run happens to generate the same content as what you posted, it will skip the POST — so there's no unnecessary churn.

## Data sources

- Weather: [Open-Meteo](https://open-meteo.com/) (no API key required)
- Tube: [TfL Unified API](https://api.tfl.gov.uk/) (no API key required)
- Lines covered: Piccadilly, District, Hammersmith & City
