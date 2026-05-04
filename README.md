# vestaboard-tube

Posts London Tube status and weather to a Vestaboard every 15 minutes via GitHub Actions. Only posts when the content has changed since the last run.

## Output format

```
MON 4 MAY 2026
15 C | DRIZZLE
{66}PICC GOOD
{66}DIST GOOD
{66}HAMM GOOD
```

Lines 3–5 are prefixed with a Vestaboard colour code: `{66}` green, `{65}` yellow, `{64}` orange, `{63}` red.

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

## Data sources

- Weather: [Open-Meteo](https://open-meteo.com/) (no API key required)
- Tube: [TfL Unified API](https://api.tfl.gov.uk/) (no API key required)
- Lines covered: Piccadilly, District, Hammersmith & City
