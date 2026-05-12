const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=51.4927&longitude=-0.2229&current=temperature_2m,weather_code&timezone=Europe/London';
const TUBE_URL =
  'https://api.tfl.gov.uk/Line/piccadilly,district,hammersmith-city/Status';
const VESTABOARD_URL = 'https://rw.vestaboard.com/';

const WEATHER_CODES = new Map([
  [0, 'SUNNY'], [1, 'SUNNY'],
  [2, 'PART CLOUD'],
  [3, 'CLOUD'],
  [45, 'FOG'], [48, 'FOG'],
  [51, 'DRIZZLE'], [53, 'DRIZZLE'], [55, 'DRIZZLE'], [56, 'DRIZZLE'], [57, 'DRIZZLE'],
  [61, 'LIGHT RAIN'],
  [63, 'MED RAIN'],
  [65, 'HEAVY RAIN'],
  [66, 'ICY RAIN'], [67, 'ICY RAIN'],
  [71, 'SNOW'], [73, 'SNOW'], [75, 'SNOW'], [77, 'SNOW'], [85, 'SNOW'], [86, 'SNOW'],
  [80, 'SHOWERS'], [81, 'SHOWERS'], [82, 'SHOWERS'],
  [95, 'STORM'], [96, 'STORM'], [99, 'STORM'],
]);

const STATUS_MAP = new Map([
  ['Good Service',    ['GOOD SERVICE',    66]],
  ['Information',     ['INFORMATION',     66]],
  ['Planned Work',    ['PLANNED WORK',    65]],
  ['Minor Delays',    ['MINOR DELAYS',    65]],
  ['Reduced Service', ['REDUCED SVC',     65]],
  ['Delays',          ['DELAYS',          64]],
  ['Part Closure',    ['PART CLOSURE',    64]],
  ['Severe Delays',   ['SEVERE DELAYS',   63]],
  ['Part Suspended',  ['PART SUSPENDED',  63]],
  ['Suspended',       ['SUSPENDED',       63]],
  ['Planned Closure', ['PLANNED CLOSE',   63]],
  ['Service Closed',  ['SERVICE CLOSED',  63]],
  ['No Service',      ['NO SERVICE',      63]],
]);

// Character → Vestaboard code (docs.vestaboard.com/docs/characterCodes)
const CHAR_TO_CODE = new Map([
  [' ', 0],
  ...Array.from({ length: 26 }, (_, i) => [String.fromCharCode(65 + i), i + 1]),
  ...Array.from({ length: 9 }, (_, i) => [String(i + 1), i + 27]),
  ['0', 36],
  ['!', 37], ['@', 38], ['#', 39], ['$', 40],
  ['(', 41], [')', 42], ['|', 43], ['-', 44],
  ['+', 46], ['&', 47], ['=', 48], [';', 49], [':', 50],
  ["'", 52], ['"', 53], ['%', 54], [',', 55], ['.', 56],
  ['/', 59], ['?', 60], ['°', 62],
]);

function charToCode(c) {
  return CHAR_TO_CODE.get(c) ?? 0;
}

// Convert text to a 22-element row, right-padded with 0s (blank tiles).
function textToRow(text) {
  const codes = Array.from(text).slice(0, 22).map(charToCode);
  while (codes.length < 22) codes.push(0);
  return codes;
}

// Build the weather row as a character code array: NNN°C DESC, centred in 22 cols.
// Character code 62 is the Flagship degree symbol — inserted directly so it survives
// the array path without relying on string-to-code conversion of '°'.
function buildWeatherRow(temp, weatherCode) {
  const desc = weatherDesc(weatherCode);
  const codes = [
    ...Array.from(String(temp)).map(charToCode),
    62, // °
    3,  // C
    0,  // space
    ...Array.from(desc).map(charToCode),
  ];
  const leftPad = Math.floor((22 - codes.length) / 2);
  const row = new Array(22).fill(0);
  codes.forEach((code, i) => {
    if (leftPad + i < 22) row[leftPad + i] = code;
  });
  return row;
}

// Centre text across 22 columns, surrounded by blank (0) tiles.
function centreRow(text) {
  const leftPad = Math.max(0, Math.floor((22 - text.length) / 2));
  const row = new Array(22).fill(0);
  Array.from(text).forEach((c, i) => {
    if (leftPad + i < 22) row[leftPad + i] = charToCode(c);
  });
  return row;
}

// Colour tile at position 0, text in positions 1–21, right-padded with 0s.
// Used by override parsing — layout is verbatim, no auto-margin.
function statusRow(colourCode, text) {
  const row = [colourCode, ...Array.from(text).slice(0, 21).map(charToCode)];
  while (row.length < 22) row.push(0);
  return row;
}

// 2-blank left margin + colour tile + text (positions 3–21), right-padded to 22 cols.
// Used for the live tube status rows so line names are inset from the board edge.
function tubeStatusRow(colourCode, text) {
  const row = [0, 0, colourCode, ...Array.from(text).slice(0, 19).map(charToCode)];
  while (row.length < 22) row.push(0);
  return row;
}

// Fetch a file from the GitHub repo. Returns empty string on 404 (file absent).
async function fetchGitHubFile(baseUrl, filename) {
  const url = `${baseUrl}/${filename}?t=${Date.now()}`;
  console.log(`fetchGitHubFile: fetching ${filename}`);
  const res = await fetch(url);
  if (res.status === 404) {
    console.log(`fetchGitHubFile: ${filename} returned 404 (empty)`);
    return '';
  }
  if (!res.ok) {
    console.log(`fetchGitHubFile: ${filename} returned non-200 status ${res.status}`);
    throw new Error(`GitHub fetch ${filename} returned ${res.status}`);
  }
  const text = (await res.text()).trim();
  console.log(`fetchGitHubFile: ${filename} returned ${text.length} chars, starts with "${text.slice(0, 30)}"`);
  return text;
}

// Returns true if the current London time falls within the quiet window defined
// in quiet_hours.txt (format: HH:MM-HH:MM). Handles midnight-spanning ranges.
async function duringQuietHours(now, env) {
  let content = '';
  try {
    content = await fetchGitHubFile(env.GITHUB_RAW_BASE, 'quiet_hours.txt');
  } catch (err) {
    console.log(`duringQuietHours: fetch failed — ${err.message}`);
    return false; // fetch error → no quiet hours
  }
  if (!content) {
    console.log('duringQuietHours: empty or missing file — skipping quiet hours');
    return false; // missing or empty file → no quiet hours
  }

  const match = content.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!match) {
    console.warn(`quiet_hours.txt format invalid (expected HH:MM-HH:MM, got "${content}") — ignoring.`);
    return false;
  }

  const [sh, sm, eh, em] = match.slice(1).map(Number);
  if (sh > 23 || sm > 59 || eh > 23 || em > 59) {
    console.warn(`quiet_hours.txt contains out-of-range time values ("${content}") — ignoring.`);
    return false;
  }

  const start = sh * 60 + sm;
  const end   = eh * 60 + em;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  const nowMins = parseInt(parts.hour) * 60 + parseInt(parts.minute);

  const inWindow = start < end
    ? nowMins >= start && nowMins < end   // same-day range, e.g. 02:00-07:00
    : nowMins >= start || nowMins < end;  // midnight-spanning, e.g. 23:00-07:00

  console.log(`Quiet hours check: content="${content}", parsedStart=${start}, parsedEnd=${end}, nowMins=${nowMins}, inWindow=${inWindow}`);

  return inWindow;
}

async function getCurrentBoardArray(key) {
  const res = await fetch(VESTABOARD_URL, {
    headers: { 'X-Vestaboard-Read-Write-Key': key },
  });
  if (!res.ok) throw new Error(`Board GET returned ${res.status}`);

  // Response: {"currentMessage":{"layout":"[[...]]",...}}
  // The layout field is a JSON-encoded string, so we need two parses total.
  const data = await res.json();
  const raw = data?.currentMessage?.layout ?? data?.layout ?? data;
  const layout = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (
    !Array.isArray(layout) ||
    layout.length !== 6 ||
    !Array.isArray(layout[0]) ||
    layout[0].length !== 22
  ) {
    throw new Error(`Unexpected layout shape: ${JSON.stringify(layout).slice(0, 120)}`);
  }

  return layout;
}

function weatherDesc(code) {
  return WEATHER_CODES.get(code) ?? 'CLEAR';
}

function lineStatus(desc) {
  return STATUS_MAP.get(desc) ?? ['CHECK STATUS', 65];
}

function formatDate(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.weekday.toUpperCase()} ${parseInt(parts.day)} ${parts.month.toUpperCase()} ${parts.year}`;
}

// Parse override.txt into a 6×22 character code array.
// Lines with a {NN} prefix (e.g. {63}, {66}) set the colour tile at position 0.
// The override.txt format is unchanged from the user's perspective.
function parseOverride(text) {
  const lines = text.split('\n').slice(0, 6);
  while (lines.length < 6) lines.push('');
  return lines.map(line => {
    const m = line.match(/^\{(\d+)\}/);
    if (m) return statusRow(parseInt(m[1]), line.slice(m[0].length));
    return textToRow(line);
  });
}

async function buildNormalArray() {
  const [weatherRes, tubeRes] = await Promise.all([
    fetch(WEATHER_URL),
    fetch(TUBE_URL),
  ]);

  if (!weatherRes.ok) throw new Error(`Weather API ${weatherRes.status}: ${await weatherRes.text()}`);
  if (!tubeRes.ok) throw new Error(`TfL API ${tubeRes.status}: ${await tubeRes.text()}`);

  const weather = await weatherRes.json();
  const tube = await tubeRes.json();

  const temp = Math.round(weather.current.temperature_2m);
  const lineById = new Map(tube.map(l => [l.id, l]));

  const tubeRows = [
    ['piccadilly',       'PICC'],
    ['district',         'DIST'],
    ['hammersmith-city', 'HAMM'],
  ].map(([id, name]) => {
    const line = lineById.get(id);
    const desc = line?.lineStatuses?.[0]?.statusSeverityDescription ?? 'Unknown';
    const [abbr, colour] = lineStatus(desc);
    return tubeStatusRow(colour, `${name} ${abbr}`);
  });

  return [
    centreRow(formatDate(new Date())),
    buildWeatherRow(temp, weather.current.weather_code),
    new Array(22).fill(0),
    ...tubeRows,
  ];
}

async function run(env) {
  const now = new Date();

  if (await duringQuietHours(now, env)) {
    console.log('Quiet hours active — skipping run.');
    return;
  }

  let override = '';
  try {
    override = await fetchGitHubFile(env.GITHUB_RAW_BASE, 'override.txt');
  } catch {}

  const newArray = override ? parseOverride(override) : await buildNormalArray();
  const newArrayStr = JSON.stringify(newArray);

  const key = env.VESTABOARD_KEY;
  if (!key) throw new Error('VESTABOARD_KEY secret not set');

  // Primary: compare against live board state so we detect external changes.
  let currentArrayStr;
  try {
    currentArrayStr = JSON.stringify(await getCurrentBoardArray(key));
  } catch (err) {
    // Fallback: use KV state if the GET fails for any reason.
    console.warn(`Board GET failed (${err.message}) — falling back to KV state`);
    currentArrayStr = (await env.STATE.get('last_message')) ?? '';
  }

  if (newArrayStr === currentArrayStr) {
    console.log(override ? 'No change (override mode), skipping post.' : 'No change detected, skipping post.');
    return;
  }

  const postRes = await fetch(VESTABOARD_URL, {
    method: 'POST',
    headers: {
      'X-Vestaboard-Read-Write-Key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ characters: newArray }),
  });

  if (!postRes.ok) {
    // Don't throw — a rejection (e.g. Vestaboard's own quiet hours) should not
    // mark the Worker invocation as failed. Don't update KV so we retry.
    const body = await postRes.text();
    console.warn(`Vestaboard POST rejected (${postRes.status}): ${body}`);
    console.warn('Skipping KV update — will retry on next run.');
    return;
  }

  console.log(override ? 'Posted override to Vestaboard.' : 'Posted to Vestaboard.');

  // Keep KV in sync as a fallback for when the board GET is unavailable.
  await env.STATE.put('last_message', newArrayStr);
}

export default {
  async scheduled(event, env, ctx) {
    await run(env);
  },
};
