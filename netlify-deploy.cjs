// Deploy ~/workspace/alphaboard-bot/dist to Netlify via the REST API.
// Creates the site on first run (name "alphabot-paper"), stores id in .site-id.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = (() => {
  try { return fs.readFileSync('/home/hatch/workspace/.cfg/netlify-token', 'utf8').trim(); }
  catch { return null; }
})();
const DIST = '/home/hatch/workspace/alphaboard-bot/dist';
const SITE_FILE = '/home/hatch/workspace/alphaboard-bot/.site-id';
const API = 'https://api.netlify.com/api/v1';

if (!TOKEN) { console.error('NF_TOKEN missing'); process.exit(1); }

const headers = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(p, rel));
    else out.push(rel);
  }
  return out;
}

async function main() {
  let siteId = null;
  try { siteId = fs.readFileSync(SITE_FILE, 'utf8').trim(); } catch {}
  if (!siteId) {
    // create site
    let res = await fetch(`${API}/sites`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'alphabot-paper' }),
    });
    let body = await res.text();
    if (!res.ok) {
      // name taken? try with random suffix
      console.log('create site:', res.status, body.slice(0, 120));
      const alt = 'alphabot-paper-' + Math.random().toString(36).slice(2, 8);
      res = await fetch(`${API}/sites`, {
        method: 'POST', headers,
        body: JSON.stringify({ name: alt }),
      });
      body = await res.text();
      if (!res.ok) throw new Error('create site failed: ' + res.status + ' ' + body.slice(0, 200));
    }
    const site = JSON.parse(body);
    siteId = site.id;
    fs.writeFileSync(SITE_FILE, siteId);
    console.log('created site:', site.name, site.ssl_url, '| id:', siteId);
  }

  const files = walk(DIST);
  console.log(`dist files: ${files.length}`);
  const manifest = {};
  const bySha = {};
  for (const f of files) {
    const buf = fs.readFileSync(path.join(DIST, f));
    const sha = crypto.createHash('sha1').update(buf).digest('hex');
    manifest['/' + f] = sha;
    bySha[sha] = f;
  }
  let res = await fetch(`${API}/sites/${siteId}/deploys`, {
    method: 'POST', headers, body: JSON.stringify({ files: manifest }),
  });
  if (!res.ok) throw new Error('create deploy failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const deploy = await res.json();
  console.log('deploy id:', deploy.id, '| required files:', (deploy.required || []).length);
  for (const sha of deploy.required || []) {
    const f = bySha[sha];
    const buf = fs.readFileSync(path.join(DIST, f));
    const url = `${API}/deploys/${deploy.id}/files/${encodeURIComponent('/' + f)}`;
    const up = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    if (!up.ok) throw new Error(`upload ${f} failed: ${up.status}`);
    console.log('uploaded', f);
  }
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const s = await (await fetch(`${API}/sites/${siteId}/deploys/${deploy.id}`, { headers })).json();
    console.log('state:', s.state);
    if (s.state === 'ready') {
      const info = await (await fetch(`${API}/sites/${siteId}`, { headers })).json();
      console.log('LIVE:', info.ssl_url || s.ssl_url);
      return;
    }
    if (s.state === 'error') throw new Error('deploy error: ' + (s.error_message || 'unknown'));
  }
  throw new Error('timed out waiting for ready');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
