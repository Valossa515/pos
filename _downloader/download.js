const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const PROFILE_DIR = path.join(__dirname, 'browser-profile');
const BASE = 'https://classicdashboard.mbx.academy';
const DEST = '/Users/felipe.ooliveira/Pos';
const COURSE_ID = 1540;

const classes = JSON.parse(fs.readFileSync(path.join(__dirname, 'classes.json'), 'utf8'));

function sanitize(name) {
  return name.replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function dateKey(info) {
  // "25/03/2025 - 19:00|21:00" -> "2025-03-25"
  const m = (info.date || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '9999-99-99';
}

async function downloadFile(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return 'skip';
  let res = await fetch(url);
  if (!res.ok && url.includes('?')) {
    // SAS signature from the API is often broken; the container is public — retry without query
    res = await fetch(url.split('?')[0]);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  return 'ok';
}

function collectFiles(nodes, prefix, out, links) {
  for (const n of nodes || []) {
    if (n.isFile && n.url) {
      out.push({ folder: prefix, name: sanitize(n.name || path.basename(n.shortUrl || 'arquivo')), url: n.url });
    } else if (!n.isFile && (n.tree || []).length) {
      collectFiles(n.tree, path.join(prefix, sanitize(n.name || 'pasta')), out, links);
    } else if (n.url || n.content) {
      links.push(`${prefix ? prefix + ' / ' : ''}${n.name || ''}: ${n.url || n.content}`);
    }
  }
}

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  const page = ctx.pages()[0] || (await ctx.newPage());

  // sort classes by date
  const sorted = Object.entries(classes).sort((a, b) => dateKey(a[1]).localeCompare(dateKey(b[1])));
  const manifest = [];
  let idx = 0;

  for (const [classId, info] of sorted) {
    idx++;
    const num = String(idx).padStart(2, '0');
    const folderName = `Aula ${num} - ${dateKey(info)} - ${sanitize(info.name)}`;
    const aulaDir = path.join(DEST, folderName);
    const entry = { classId, name: info.name, folder: folderName, files: [], errors: [] };
    manifest.push(entry);

    console.log(`\n[${num}/${sorted.length}] ${info.name} (classId=${classId})`);

    try {
      const respPromise = page.waitForResponse(
        (r) => /api\.class\.movelms\.com\/api\/v1\/Classes\/[a-f0-9]+$/.test(r.url()) && r.status() === 200,
        { timeout: 45000 }
      );
      await page.goto(`${BASE}/CourseClass/WatchClass/${classId}?courseId=${COURSE_ID}`, {
        waitUntil: 'domcontentloaded', timeout: 45000,
      });
      const resp = await respPromise;
      const data = JSON.parse(await resp.text());

      const files = [], links = [];
      collectFiles(data.materials, '', files, links);

      if (!files.length && !links.length) {
        console.log('  (sem materiais)');
        entry.note = 'sem materiais';
        continue;
      }

      fs.mkdirSync(aulaDir, { recursive: true });
      if (links.length) {
        fs.writeFileSync(path.join(aulaDir, 'links.txt'), links.join('\n') + '\n');
        console.log(`  links.txt (${links.length} links)`);
      }
      for (const f of files) {
        const dest = path.join(aulaDir, f.folder, f.name);
        try {
          const st = await downloadFile(f.url, dest);
          entry.files.push(path.join(f.folder, f.name));
          console.log(`  [${st}] ${path.join(f.folder, f.name)}`);
        } catch (e) {
          entry.errors.push(`${f.name}: ${e.message}`);
          console.log(`  [ERRO] ${f.name}: ${e.message}`);
        }
      }
    } catch (e) {
      entry.errors.push(`página: ${e.message.split('\n')[0]}`);
      console.log(`  [ERRO página] ${e.message.split('\n')[0]}`);
    }
    fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 1));
  }

  await ctx.close();

  const totFiles = manifest.reduce((s, m) => s + m.files.length, 0);
  const totErr = manifest.reduce((s, m) => s + m.errors.length, 0);
  console.log(`\n=== FIM: ${totFiles} arquivos baixados, ${totErr} erros ===`);
})();
