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
  ['Good Service',    ['GOOD',       '{66}']],
  ['Information',     ['INFO',       '{66}']],
  ['Planned Work',    ['WORKS',      '{65}']],
  ['Minor Delays',    ['MINOR',      '{65}']],
  ['Reduced Service', ['REDUCED',    '{65}']],
  ['Delays',          ['DELAYS',     '{64}']],
  ['Part Closure',    ['PART CLOSE', '{64}']],
  ['Severe Delays',   ['SEVERE',     '{63}']],
  ['Part Suspended',  ['PART SUSP',  '{63}']],
  ['Suspended',       ['SUSP',       '{63}']],
  ['Planned Closure', ['CLOSED',     '{63}']],
  ['Service Closed',  ['CLOSED',     '{63}']],
  ['No Service',      ['NO SERVICE', '{63}']],
]);

// Vestaboard character code → string (docs.vestaboard.com/docs/characterCodes)
const CHAR_CODES = new Map([
  [0, ' '],
  // A–Z: codes 1–26
  ...Array.from({ length: 26 }, (_, i) => [i + 1, String.fromCharCode(65 + i)]),
  // 1–9: codes 27–35
  ...Array.from({ length: 9 }, (_, i) => [i + 27, String(i + 1)]),
  [36, '0'],
  [37, '!'], [38, '@'], [39, '#'], [40, '$'],
  [41, '('], [42, ')'], [43, '|'], [44, '-'],
  [46, '+'], [47, '&'], [48, '='], [49, ';'], [50, ':'],
  [52, "'"], [53, '"'], [54, '%'], [55, ','], [56, '.'],
  [59, '/'], [60, '?'], [62, '°'],
  // Colour/fill squares → {XX} tokens matching our outgoing format
  ...Array.from({ length: 9 }, (_, i) => [i + 63, `{${i + 63}}`]),
]);

function decodeChar(code) {
  return CHAR_CODES.get(code) ?? '';
}

function decodeLayout(layout) {
  return layout
    .map(row => row.map(decodeChar).join('').trimEnd())
    .join('\n');
}

// Fetch a file from the GitHub repo. Returns empty string on 404 (file absent).
async function fetchGitHubFile(baseUrl, filename) {
  const url = `${baseUrl}/${filename}?t=${Date.now()}`;
  const res = await fetch(url);
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`GitHub fetch ${filename} returned ${res.status}`);
  return (await res.text()).trim();
}

// Returns true if the current London time falls within the quiet window defined
// in quiet_hours.txt (format: HH:MM-HH:MM). Handles midnight-spanning ranges.
async function duringQuietHours(now, env) {
  let content = '';
  try {
    content = await fetchGitHubFile(env.GITHUB_RAW_BASE, 'quiet_hours.txt');
  } catch {
    return false; // fetch error → no quiet hours
  }
  if (!content) return false; // missing or empty file → no quiet hours

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

async function getCurrentBoardState(key) {
  const res = await fetch(VESTABOARD_URL, {
    headers: { 'X-Vestaboard-Read-Write-Key': key },
  });
  if (!res.ok) throw new Error(`Board GET returned ${res.status}`);

  // Response: {"currentMessage":{"layout":"[[...]]",...}}
  // The layout field is a JSON-encoded string, so we need two parses total
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

  return decodeLayout(layout);
}

function weatherDesc(code) {
  return WEATHER_CODES.get(code) ?? 'CLEAR';
}

function lineStatus(desc) {
  return STATUS_MAP.get(desc) ?? ['CHECK', '{65}'];
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

async function buildNormalMessage() {
  const [weatherRes, tubeRes] = await Promise.all([
    fetch(WEATHER_URL),
    fetch(TUBE_URL),
  ]);

  if (!weatherRes.ok) {
    throw new Error(`Weather API ${weatherRes.status}: ${await weatherRes.text()}`);
  }
  if (!tubeRes.ok) {
    throw new Error(`TfL API ${tubeRes.status}: ${await tubeRes.text()}`);
  }

  const weather = await weatherRes.json();
  const tube = await tubeRes.json();

  const dateLine = formatDate(new Date());
  const temp = Math.round(weather.current.temperature_2m);
  const weatherLine = `${temp} C | ${weatherDesc(weather.current.weather_code)}`;

  const lineById = new Map(tube.map(l => [l.id, l]));
  const tubeLines = [
    ['piccadilly',       'PICC'],
    ['district',         'DIST'],
    ['hammersmith-city', 'HAMM'],
  ].map(([id, name]) => {
    const line = lineById.get(id);
    const desc = line?.lineStatuses?.[0]?.statusSeverityDescription ?? 'Unknown';
    const [abbr, colour] = lineStatus(desc);
    return `${colour}${name} ${abbr}`;
  });

  return [dateLine, weatherLine, '', ...tubeLines].join('\n');
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

  const message = override || await buildNormalMessage();

  const key = env.VESTABOARD_KEY;
  if (!key) throw new Error('VESTABOARD_KEY secret not set');

  // Primary: compare against live board state so we detect external changes
  let currentState;
  try {
    currentState = await getCurrentBoardState(key);
  } catch (err) {
    // Fallback: use KV state if the GET fails for any reason
    console.warn(`Board GET failed (${err.message}) — falling back to KV state`);
    currentState = (await env.STATE.get('last_message')) ?? '';
  }

  if (message === currentState) {
    console.log(override ? 'No change (override mode), skipping post.' : 'No change detected, skipping post.');
    return;
  }

  const postRes = await fetch(VESTABOARD_URL, {
    method: 'POST',
    headers: {
      'X-Vestaboard-Read-Write-Key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: message }),
  });

  if (!postRes.ok) {
    // Don't throw — a rejection (e.g. Vestaboard's own quiet hours) should not
    // mark the Worker invocation as failed. Don't update KV so we retry.
    const body = await postRes.text();
    console.warn(`Vestaboard POST rejected (${postRes.status}): ${body}`);
    console.warn('Skipping KV update — will retry on next run.');
    return;
  }

  console.log(override ? 'Posted override to Vestaboard:' : 'Posted to Vestaboard:');
  console.log(message);

  // Keep KV in sync as a fallback for when the board GET is unavailable
  await env.STATE.put('last_message', message);
}

export default {
  async scheduled(event, env, ctx) {
    await run(env);
  },
};
