import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAST_MSG_FILE = path.join(__dirname, 'last_message.txt');
const OVERRIDE_FILE = path.join(__dirname, 'override.txt');

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

async function main() {
  let override = '';
  try {
    override = fs.readFileSync(OVERRIDE_FILE, 'utf8').trim();
  } catch {}

  const message = override || await buildNormalMessage();

  let lastMessage = '';
  try {
    lastMessage = fs.readFileSync(LAST_MSG_FILE, 'utf8').trim();
  } catch {}

  if (message === lastMessage) {
    console.log(override ? 'No change (override mode), skipping post.' : 'No change detected, skipping post.');
    return;
  }

  const key = process.env.VESTABOARD_KEY;
  if (!key) throw new Error('VESTABOARD_KEY env var not set');

  const postRes = await fetch(VESTABOARD_URL, {
    method: 'POST',
    headers: {
      'X-Vestaboard-Read-Write-Key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: message }),
  });

  if (!postRes.ok) {
    throw new Error(`Vestaboard POST ${postRes.status}: ${await postRes.text()}`);
  }

  console.log(override ? 'Posted override to Vestaboard:' : 'Posted to Vestaboard:');
  console.log(message);
  fs.writeFileSync(LAST_MSG_FILE, message, 'utf8');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
