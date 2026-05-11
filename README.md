# vestaboard-tube

Posts London Tube status and weather to a Vestaboard every 5 minutes via a Cloudflare Worker. Only posts when the content has changed since the last run.

## Architecture

| Concern | How it works |
|---|---|
| **Scheduling** | Cloudflare Workers cron trigger (`*/5 * * * *`) |
| **State (last message)** | Workers KV — no commit-back needed |
| **Config files** | `override.txt` and `quiet_hours.txt` stay in this GitHub repo; the Worker fetches them via GitHub's raw content URLs at runtime |
| **Deployment** | Push to `main` → GitHub Action runs `wrangler deploy` → new Worker is live within seconds |

## Normal output format

```
MON 4 MAY 2026
16 C | CLOUD

{66}PICC GOOD SERVICE
{66}DIST GOOD SERVICE
{66}HAMM GOOD SERVICE
```

Rows 1 and 2 (date and weather) are auto-centred on the 22-character-wide board. Row 3 is blank. Rows 4–6 are prefixed with a colour code: `{66}` green, `{65}` yellow, `{64}` orange, `{63}` red.

## Using overrides

You can push any message to the Vestaboard by editing `override.txt` in the repo root. While the file has content, the normal tube/weather logic is skipped entirely.

### How to use

1. Edit `override.txt` — write your message, one row per line
2. Commit and push (or commit via GitHub mobile app)
3. Wait up to 15 minutes for the next scheduled run

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

Clear the contents of `override.txt` (leave the file empty), commit, and push. The next run will resume normal tube/weather output.

### Editing from your phone

`override.txt` can be edited directly in the GitHub mobile app — exactly as before:

1. Open the repo → tap `override.txt` → tap the pencil icon
2. Edit the content, scroll down, tap **Commit changes**
3. Done — the Worker fetches the file fresh (with cache-busting) on every run, so it picks up your change within 15 minutes

`quiet_hours.txt` works the same way.

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

### 1. Install Wrangler

```sh
npm install -g wrangler
wrangler login
```

### 2. Create the KV namespace

```sh
wrangler kv namespace create STATE
```

Copy the `id` from the output and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "STATE"
id = "paste-your-id-here"
```

Commit and push the updated `wrangler.toml`.

### 3. Add the Vestaboard secret

```sh
wrangler secret put VESTABOARD_KEY
```

Paste your Vestaboard read/write key when prompted. This is stored encrypted in Cloudflare — it never touches the repo.

### 4. Wire up auto-deploy from GitHub

The `.github/workflows/deploy.yml` action runs `wrangler deploy` on every push to `main`. It needs a Cloudflare API token:

1. Go to [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**
2. Use the **Edit Cloudflare Workers** template
3. In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|------|-------|
| `CLOUDFLARE_API_TOKEN` | The token you just created |

After that, every push to `main` automatically deploys the latest Worker code.

### 5. Deploy manually (first time or on demand)

```sh
wrangler deploy
```

## Testing the Worker

### Stream live logs

```sh
wrangler tail
```

Logs appear in real time whenever the Worker runs (cron or manual trigger).

### Trigger a run manually

**From the Cloudflare dashboard:**
Workers & Pages → `vestaboard-tube` → **Triggers** tab → **Test scheduled event**

**From the terminal (local simulation):**
```sh
wrangler dev --test-scheduled
```
Then in a second terminal:
```sh
curl "http://localhost:8787/__scheduled?cron=*%2F15+*+*+*+*"
```

This runs the full Worker logic locally against the live Vestaboard and GitHub APIs — useful for debugging without waiting for the cron.

## Quiet hours

There are two independent quiet-hours mechanisms:

| | `quiet_hours.txt` (this Worker) | Vestaboard app / dashboard |
|---|---|---|
| **What it does** | Stops the Worker from running at all | Rejects POST requests to the board |
| **Saves API calls** | Yes | No — the Worker still runs |
| **Protects the board from all automation** | No | Yes |

It is recommended to set both to the same window. The Worker handles each gracefully:
- If the Worker's own quiet hours are active, it exits immediately — no weather or tube data is fetched.
- If the Vestaboard's quiet hours reject a POST, the Worker logs the rejection and exits cleanly. KV state is not updated, so the post will be retried on the next run after quiet hours end.

### Setting the Worker's quiet hours

Edit `quiet_hours.txt` in the repo root. The file must contain a single line in `HH:MM-HH:MM` format (24-hour, London time):

```
23:00-07:00
```

This means the Worker will skip all runs between 11 pm and 7 am. Ranges that span midnight work correctly. To disable, clear the file (leave it empty).

Edit via the GitHub mobile app (tap the file → pencil icon → commit) or commit and push from your terminal. Changes take effect on the next scheduled run — no redeployment needed.

## Manual updates from the Vestaboard app

You can push any message directly via the Vestaboard app or any other API client. The Worker compares the new message against the actual live board state, so if it wants to display different content it will overwrite whatever is on the board within 15 minutes.

Use `override.txt` for sustained custom messages so the Worker doesn't fight with you.

## Data sources

- Weather: [Open-Meteo](https://open-meteo.com/) (no API key required)
- Tube: [TfL Unified API](https://api.tfl.gov.uk/) (no API key required)
- Lines covered: Piccadilly, District, Hammersmith & City
