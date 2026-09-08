const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, 'browser-profile');
const BASE = 'https://classicdashboard.mbx.academy';

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(BASE + '/CourseClass/Index/590436', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Fetch LoadCards for all statuses from within the page (session cookies apply)
  const results = {};
  for (const status of [1, 2, 3, 4, '']) {
    const body = await page.evaluate(async (st) => {
      const url = `/CourseClass/LoadCards?courseRegistrationId=590436&classStudentId=2060&courseId=1540&status=${st}&selectedOrder=2&_=${Date.now()}`;
      const r = await fetch(url, { credentials: 'include' });
      return await r.text();
    }, status);
    results[String(status)] = body;
    console.log(`status=${status}: ${body.length} bytes`);
  }
  fs.writeFileSync(path.join(__dirname, 'loadcards.json'), JSON.stringify(results));
  await ctx.close();

  // Parse the card HTML into classes.json (id -> {name, statuses, date})
  const classes = {};
  for (const [status, body] of Object.entries(results)) {
    let html;
    try {
      html = JSON.parse(body).data || '';
    } catch (e) {
      console.log(`status=${status}: resposta não é JSON, ignorando`);
      continue;
    }
    for (const card of html.split('loadMoreItem col').slice(1)) {
      const id = (card.match(/id="card_(\d+)"/) || [])[1];
      if (!id) continue;
      const date = (card.match(/card-small-text-11">([^<]*)</) || [])[1] || '';
      const name = (card.match(/<h4[^>]*><strong>([\s\S]*?)<\/strong>/) || [])[1] || '';
      const c = (classes[id] = classes[id] || { name: decode(name), statuses: [], date: decode(date).trim() });
      if (!c.statuses.includes(status)) c.statuses.push(status);
    }
  }

  const prev = fs.existsSync(path.join(__dirname, 'classes.json'))
    ? JSON.parse(fs.readFileSync(path.join(__dirname, 'classes.json'), 'utf8'))
    : {};
  const novas = Object.keys(classes).filter((id) => !prev[id]);
  fs.writeFileSync(path.join(__dirname, 'classes.json'), JSON.stringify(classes, null, 1));
  console.log(`\nclasses.json: ${Object.keys(classes).length} aulas (antes: ${Object.keys(prev).length})`);
  for (const id of novas) console.log(`  + ${classes[id].date} - ${classes[id].name} (classId=${id})`);
  console.log('DONE');
})();

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
