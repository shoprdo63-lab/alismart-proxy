const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','into','onto','upon','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','shall','should','may',
  'might','must','can','could','that','which','who','whom','this','these',
  'those','it','its','i','me','my','we','us','our','you','your','he','him',
  'his','she','her','they','them','their','what','where','when','how','all',
  'each','every','both','few','more','most','other','some','such','no','not',
  'only','own','same','so','than','too','very','just','new','free','sale',
  'hot','top','best','high','quality','premium','luxury','original','official',
  'genuine','brand','set','kit','pack','pcs','piece','pieces','lot','style',
  'fashion','shipping','fast','portable','mini','pro','max','plus','ultra',
  'super','wholesale','retail','bulk','2024','2025','2026'
]);

function extractNouns(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}

function calcRelevanceScore(query, title) {
  const queryNouns = extractNouns(query);
  console.log('Query nouns:', queryNouns);
  if (queryNouns.length === 0) return 100;
  const titleLower = (title || '').toLowerCase();
  let matched = 0;
  for (const noun of queryNouns) {
    if (titleLower.includes(noun)) matched++;
  }
  const score = Math.round((matched / queryNouns.length) * 100 * 10) / 10;
  console.log('Matched:', matched, 'out of', queryNouns.length, 'score:', score);
  return score;
}

const query = 'wireless bluetooth headphones noise cancelling';
console.log('Testing query:', JSON.stringify(query));
console.log('Length:', query.length);

// Test each step
const lower = query.toLowerCase();
console.log('Lowercase:', JSON.stringify(lower));

const replaced = lower.replace(/[^a-z0-9\s]/g, ' ');
console.log('After replace:', JSON.stringify(replaced));
console.log('Replaced === original?', replaced === lower);

const split = replaced.split(/\s+/);
console.log('Split result:', JSON.stringify(split));
console.log('Split length:', split.length);

const nouns = extractNouns(query);
console.log('Final nouns:', nouns);
console.log('Nouns length:', nouns.length);

// Test with a title
const title = 'Premium Wireless Bluetooth Headphones with Noise Cancellation, 30-Hour Battery Life, Hi-Fi Sound for Travel & Work';
const score = calcRelevanceScore(query, title);
console.log('Final score:', score);

// Also test a simpler query
console.log('\n--- Testing simpler query: "wireless headphones" ---');
const simpleQuery = 'wireless headphones';
const simpleNouns = extractNouns(simpleQuery);
console.log('Simple query nouns:', simpleNouns);
const simpleScore = calcRelevanceScore(simpleQuery, title);
console.log('Simple score:', simpleScore);