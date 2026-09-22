const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, 'browser-profile');
const CLASSIC = 'https://classicdashboard.mbx.academy';
const TIMEOUT_MIN = 10;

const host = (u) => { try { return new URL(u).host; } catch (e) { return ''; } };
const isLoginUrl = (u) => /b2clogin|\/Account\/(Login|SignIn)/i.test(u);
// qualquer host do LMS que NÃO seja tela de login conta como "logado"
const isLoggedInUrl = (u) =>
  /\.mbx\.academy$/.test(host(u)) && !isLoginUrl(u) && !/^about:/.test(u);
const isClassic = (u) => host(u) === 'classicdashboard.mbx.academy' && !isLoginUrl(u);

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
  });

  const pages = new Set(ctx.pages());
  ctx.on('page', (p) => { pages.add(p); p.on('close', () => pages.delete(p)); });

  // Grava as chamadas de API do portal (pra portar list-classes/download pro site novo)
  const api = [];
  ctx.on('response', async (res) => {
    const u = res.url();
    if (!/\/api\//i.test(u) && !/movelms|mbx\.academy/.test(host(u))) return;
    if (/\.(js|css|png|jpe?g|svg|woff2?|ico|map)(\?|$)/i.test(u)) return;
    const rec = { method: res.request().method(), url: u, status: res.status() };
    try {
      const ct = (res.headers()['content-type'] || '');
      if (ct.includes('json')) rec.sample = (await res.text()).slice(0, 4000);
    } catch (e) { /* corpo indisponível */ }
    api.push(rec);
  });

  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(CLASSIC + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('>>> Aguardando login do usuário...');
  console.log('>>> (faça o login na janela aberta; vou mostrar cada URL por onde passar)');

  const deadline = Date.now() + TIMEOUT_MIN * 60 * 1000;
  const seen = new Set();
  let ok = null;

  while (Date.now() < deadline && !ok) {
    await page.waitForTimeout(2000).catch(() => {});
    for (const p of pages) {
      if (p.isClosed()) { pages.delete(p); continue; }
      let u = '';
      try { u = p.url(); } catch (e) { continue; }
      if (u && !seen.has(u)) { seen.add(u); console.log('    [url] ' + u); }
      if (!ok && isLoggedInUrl(u)) {
        let html = '';
        try { html = await p.content(); } catch (e) { continue; }
        if (html.length > 3000 && !isLoginUrl(p.url())) ok = p;
      }
    }
  }

  if (!ok) {
    console.log('\n>>> TIMEOUT: login não detectado em ' + TIMEOUT_MIN + ' minutos.');
    console.log('>>> URLs vistas:'); for (const u of seen) console.log('      ' + u);
    await ctx.close();
    process.exit(1);
  }

  console.log('\n>>> LOGIN DETECTADO! URL: ' + ok.url());
  await ok.waitForTimeout(6000).catch(() => {});   // deixa a SPA carregar e chamar a API

  const portal = isClassic(ok.url()) ? 'classico' : 'novo';
  console.log('>>> Portal: ' + portal.toUpperCase() + ' (' + host(ok.url()) + ')');

  fs.writeFileSync(path.join(__dirname, 'dashboard.html'), await ok.content());
  console.log('>>> dashboard.html salvo');

  // Se caiu no portal novo, testa se o clássico ainda responde pra esta conta
  let classicOk = isClassic(ok.url());
  if (!classicOk) {
    console.log('>>> Testando se o dashboard CLÁSSICO ainda funciona nesta conta...');
    const probe = await ctx.newPage();
    await probe.goto(CLASSIC + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await probe.waitForTimeout(6000).catch(() => {});
    classicOk = isClassic(probe.url());
    console.log('    [classico] ' + probe.url() + '  -> ' + (classicOk ? 'FUNCIONA' : 'INDISPONIVEL (redirecionou)'));
    if (classicOk) fs.writeFileSync(path.join(__dirname, 'dashboard-classic.html'), await probe.content());
    await probe.close().catch(() => {});
  }

  await ctx.storageState({ path: path.join(__dirname, 'state.json') });
  console.log('>>> state.json salvo');

  fs.writeFileSync(path.join(__dirname, 'api-log.json'), JSON.stringify(api, null, 1));
  console.log('>>> api-log.json salvo (' + api.length + ' chamadas capturadas)');

  fs.writeFileSync(path.join(__dirname, 'login-info.json'),
    JSON.stringify({ portal, url: ok.url(), classicOk, urls: [...seen] }, null, 1));

  await ctx.close();
  console.log('>>> DONE — portal=' + portal + ', classico=' + (classicOk ? 'ok' : 'indisponivel'));
})();
