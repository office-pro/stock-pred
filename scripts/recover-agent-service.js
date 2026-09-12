const fs = require('fs');
const path = require('path');

const dir = path.join(
  process.env.USERPROFILE || '',
  '.cursor',
  'projects',
  'c-Users-asus-stock-pred',
  'agent-transcripts',
);

function walk(d, out = []) {
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

const files = walk(dir);
console.log('transcript files', files.length);

let best = null;
let bestLen = 0;
let bestFile = '';

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  if (!text.includes('agent.service.ts')) continue;
  for (const line of text.split('\n')) {
    if (!line.includes('agent.service.ts')) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = j?.message || j;
    const content = msg?.content;
    const blocks = Array.isArray(content) ? content : [];
    for (const block of blocks) {
      if (block?.type !== 'tool_use') continue;
      if (block?.name !== 'Write' && block?.name !== 'StrReplace') continue;
      const input = block.input || {};
      const p = String(input.path || '');
      if (!p.replace(/\\/g, '/').endsWith('agent/agent.service.ts')) continue;
      const body = input.contents || input.new_string;
      if (typeof body !== 'string') continue;
      if (!body.includes('class AgentService')) continue;
      if (body.length > bestLen) {
        best = body;
        bestLen = body.length;
        bestFile = f;
      }
    }
  }
}

console.log('bestLen', bestLen, 'from', bestFile);
if (best) {
  const out = path.join(
    __dirname,
    '..',
    'apps',
    'trader-agent',
    'src',
    'agent',
    'agent.service.recovered.ts',
  );
  fs.writeFileSync(out, best, 'utf8');
  console.log('wrote', out);
} else {
  console.log('no recovery candidate');
}
