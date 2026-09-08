const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, 'browser-profile');
const BASE = 'https://classicdashboard.mbx.academy';

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  console.log('>>> Aguardando login do usuário...');

  // Wait until we land back on the dashboard host, logged in (max 10 min)
  const deadline = Date.now() + 10 * 60 * 1000;
  let loggedIn = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    try {
      const url = page.url();
      if (url.startsWith(BASE)) {
        // check it isn't immediately bouncing to b2clogin
        const html = await page.content();
        if (!/b2clogin/i.test(url) && html.length > 5000) {
          loggedIn = true;
          break;
        }
      }
    } catch (e) { /* page navigating */ }
  }

  if (!loggedIn) {
    console.log('>>> TIMEOUT: login não detectado em 10 minutos.');
    await ctx.close();
    process.exit(1);
  }

  console.log('>>> LOGIN DETECTADO! URL: ' + page.url());
  await page.waitForTimeout(5000); // let SPA settle

  // Save dashboard HTML for structure analysis
  const html = await page.content();
  fs.writeFileSync(path.join(__dirname, 'dashboard.html'), html);
  console.log('>>> Dashboard HTML salvo (' + html.length + ' bytes)');

  // Also save storage state (cookies) for reuse
  await ctx.storageState({ path: path.join(__dirname, 'state.json') });
  console.log('>>> Sessão salva. Pode fechar? Não — fecharei sozinho.');
  await ctx.close();
  console.log('>>> DONE');
})();
