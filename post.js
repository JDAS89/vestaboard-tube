import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAST_MSG_FILE    = path.join(__dirname, 'last_message.json');
const OVERRIDE_FILE    = path.join(__dirname, 'override.txt');
const QUIET_HOURS_FILE = path.join(__dirname, 'quiet_hours.txt');

const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=51.4927&longitude=-0.2229&current=temperature_2m,weather_code&timezone=Europe/London';
const TUBE_URL =
  'https://api.tfl.gov.uk/Line/piccadilly,district,hammersmith-city/Status';
const VESTABOARD_URL = 'https://rw.vestaboard.com/';

const WEATHER_CODES = new Map([
  [0, 'SUN'], [1, 'SUN'],
  [2, 'PART CLOUD'],
  [3, 'CLOUD'],
  [45, 'FOG'], [48, 'FOG'],
  [51, 'DRIZZLE'], [53, 'DRIZZLE'], [55, 'DRIZZLE'], [56, 'DRIZZLE'], [57, 'DRIZZLE'],
  [61, 'LOW RAIN'],
  [63, 'MED RAIN'],
  [65, 'HEAVY RAIN'],
  [66, 'FRZ RAIN'], [67, 'FRZ RAIN'],
  [71, 'SNOW'], [73, 'SNOW'], [75, 'SNOW'], [77, 'SNOW'], [85, 'SNOW'], [86, 'SNOW'],
  [80, 'SHOWERS'], [81, 'SHOWERS'], [82, 'SHOWERS'],
  [95, 'STORM'], [96, 'STORM'], [99, 'STORM'],
]);

const STATUS_MAP = new Map([
  ['Good Service',    ['GOOD',       66]],
  ['Information',     ['INFO',       66]],
  ['Planned Work',    ['WORKS',      65]],
  ['Minor Delays',    ['MINOR',      65]],
  ['Reduced Service', ['REDUCED',    65]],
  ['Delays',          ['DELAYS',     64]],
  ['Part Closure',    ['PART CLOSE', 64]],
  ['Severe Delays',   ['SEVERE',     63]],
  ['Part Suspended',  ['PART SUSP',  63]],
  ['Suspended',       ['SUSP',       63]],
  ['Planned Closure', ['CLOSED',     63]],
  ['Service Closed',  ['CLOSED',     63]],
  ['No Service',      ['NO SERVICE', 63]],
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
function statusRow(colourCode, text) {
  const row = [colourCode, ...Array.from(text).slice(0, 21).map(charToCode)];
  while (row.length < 22) row.push(0);
  return row;
}

// Returns true if the current London time falls within the quiet window defined
// in quiet_hours.txt (format: HH:MM-HH:MM). Handles midnight-spanning ranges.
function duringQuietHours(now) {
  let content = '';
  try {
    content = fs.readFileSync(QUIET_HOURS_FILE, 'utf8').trim();
  } catch {
    return false; // missing file → no quiet hours
  }
  if (!content) return false; // empty file → no quiet hours

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

  return start < end
    ? nowMins >= start && nowMins < end   // same-day range, e.g. 02:00-07:00
    : nowMins >= start || nowMins < end;  // midnight-spanning, e.g. 23:00-07:00
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
  return STATUS_MAP.get(desc) ?? ['CHECK', 65];
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
    return statusRow(colour, `${name} ${abbr}`);
  });

  return [
    centreRow(formatDate(new Date())),
    centreRow(`${temp} C | ${weatherDesc(weather.current.weather_code)}`),
    new Array(22).fill(0),
    ...tubeRows,
  ];
}

async function main() {
  const now = new Date();

  if (duringQuietHours(now)) {
    console.log('Quiet hours active — skipping run.');
    return;
  }

  let override = '';
  try {
    override = fs.readFileSync(OVERRIDE_FILE, 'utf8').trim();
  } catch {}

  const newArray = override ? parseOverride(override) : await buildNormalArray();
  const newArrayStr = JSON.stringify(newArray);

  const key = process.env.VESTABOARD_KEY;
  if (!key) throw new Error('VESTABOARD_KEY env var not set');

  // Primary: compare against live board state so we detect external changes.
  let currentArrayStr;
  try {
    currentArrayStr = JSON.stringify(await getCurrentBoardArray(key));
  } catch (err) {
    // Fallback: use last_message.json if the GET fails for any reason.
    console.warn(`Board GET failed (${err.message}) — falling back to last_message.json`);
    try {
      currentArrayStr = fs.readFileSync(LAST_MSG_FILE, 'utf8').trim();
    } catch {
      currentArrayStr = '';
    }
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
    // mark the Actions run as failed. Don't update last_message.json so we retry.
    const body = await postRes.text();
    console.warn(`Vestaboard POST rejected (${postRes.status}): ${body}`);
    console.warn('Skipping last_message.json update — will retry on next run.');
    return;
  }

  console.log(override ? 'Posted override to Vestaboard.' : 'Posted to Vestaboard.');

  // Keep last_message.json in sync as a fallback for when the GET is unavailable.
  fs.writeFileSync(LAST_MSG_FILE, newArrayStr, 'utf8');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
