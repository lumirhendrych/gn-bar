// GN Bar — rychlá kasa pro barmany: položky → hotově / kartou (PayPhone od KB SmartPay)
'use strict';

const VYCHOZI_CENIK = `Drinky 0,3 l; Křídla; 120
Drinky 0,3 l; Vodka džus; 120
Drinky 0,3 l; Vodka Sprite; 120
Drinky 0,3 l; Morgan a cola; 120
Drinky 0,3 l; Gin tonic; 140
Panáky; Nicolaus vodka; 60
Panáky; Božkov; 60
Panáky; Republica; 80
Panáky; Beefeater gin; 80
Panáky; Jägermeister; 80
Panáky; Jack Honey; 80
Panáky; Bumbu; 150
Pivo a nealko; Černá Hora; 50
Pivo a nealko; Kofola; 50
Pivo a nealko; Džus; 50
Pivo a nealko; Tonik; 50
Pivo a nealko; Tiger; 50
Pivo a nealko; Voda; 30
Kýbl 5 l; Kýbl Křídla; 1200
Kýbl 5 l; Kýbl Morgan; 1200`;

// Android: package appky PayPhone z Google Play (eu.softpos.softposwrapper.kb)
const ANDROID_PACKAGE = 'eu.softpos.softposwrapper.kb';
const IOS_ZKRATKA = 'PayPhone';

const K = { nast: 'gnbar.nastaveni', prodeje: 'gnbar.prodeje', cekajici: 'gnbar.cekajici' };
const $ = s => document.querySelector(s);
const kc = n => n.toLocaleString('cs-CZ') + ' Kč';

let nast = Object.assign({ barman: '', rezim: odhadRezim(), vlastni: '', sumupKlic: '', sumupAppId: '', cenik: VYCHOZI_CENIK },
  JSON.parse(localStorage.getItem(K.nast) || '{}'));
let prodeje = JSON.parse(localStorage.getItem(K.prodeje) || '[]');
let ucet = {};            // název → počet
let polozky = [];         // [{kat, n, p}]
let platbaKartou = null;  // rozpracovaná platba kartou

function odhadRezim() { return /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : 'android'; }

// ---------- ceník ----------
function nactiCenik() {
  polozky = nast.cenik.split('\n').map(r => r.split(';').map(x => x.trim()))
    .filter(r => r.length >= 3 && r[1] && !isNaN(parseInt(r[2])))
    .map(([kat, n, p]) => ({ kat, n, p: parseInt(p) }));
}

function vykresliMenu() {
  const m = $('#menu'); m.innerHTML = '';
  const kat = [...new Set(polozky.map(p => p.kat))];
  for (const k of kat) {
    m.insertAdjacentHTML('beforeend', `<div class="kat">${esc(k)}</div>`);
    const g = document.createElement('div'); g.className = 'grid';
    for (const p of polozky.filter(x => x.kat === k)) {
      const b = document.createElement('button'); b.className = 'item';
      b.innerHTML = `<span class="n">${esc(p.n)}</span><span class="p">${p.p} Kč</span>` +
        (ucet[p.n] ? `<span class="q">${ucet[p.n]}</span>` : '');
      b.onclick = () => { ucet[p.n] = (ucet[p.n] || 0) + 1; vibr(); prekresli(); };
      g.appendChild(b);
    }
    m.appendChild(g);
  }
}

// ---------- účet ----------
const cenaPolozky = n => (polozky.find(p => p.n === n) || { p: 0 }).p;
const soucet = () => Object.entries(ucet).reduce((s, [n, q]) => s + cenaPolozky(n) * q, 0);

function vykresliUcet() {
  const el = $('#polozkyUctu'); el.innerHTML = '';
  for (const [n, q] of Object.entries(ucet)) {
    const c = document.createElement('button'); c.className = 'chip';
    c.innerHTML = `<b>${q}×</b> ${esc(n)} −`;
    c.onclick = () => { if (--ucet[n] <= 0) delete ucet[n]; prekresli(); };
    el.appendChild(c);
  }
  const s = soucet();
  $('#total').textContent = kc(s);
  $('#btnHotove').disabled = $('#btnKartou').disabled = s === 0;
}

function prekresli() { vykresliMenu(); vykresliUcet(); }

function zaznamenej(zpusob, castka, dal, tx) {
  prodeje.push({ t: Date.now(), z: zpusob, c: castka, dal: dal || null, tx: tx || null,
    o: Object.entries(ucet).map(([n, q]) => ({ n, q, p: cenaPolozky(n) })), b: nast.barman });
  localStorage.setItem(K.prodeje, JSON.stringify(prodeje));
  ucet = {}; prekresli(); toast((zpusob === 'karta' ? 'Kartou ' : 'Hotově ') + kc(castka) + ' ✓');
}

// ---------- hotově ----------
$('#btnHotove').onclick = () => {
  const s = soucet(); let dal = null;
  $('#hCastka').textContent = kc(s); $('#hVratit').textContent = '';
  const kolik = [...new Set([s, Math.ceil(s / 100) * 100, Math.ceil(s / 500) * 500, Math.ceil(s / 1000) * 1000, 2000, 5000])]
    .filter(x => x >= s).slice(0, 4);
  const g = $('#hDal'); g.innerHTML = '';
  for (const x of kolik) {
    const b = document.createElement('button'); b.textContent = x === s ? 'Přesně' : x;
    b.onclick = () => {
      dal = x; g.querySelectorAll('button').forEach(y => y.classList.toggle('on', y === b));
      $('#hVratit').textContent = x > s ? 'Vrátit ' + kc(x - s) : 'Bez vracení';
    };
    g.appendChild(b);
  }
  $('#hOk').onclick = () => { zavri(); zaznamenej('hotove', s, dal); };
  $('#dlgHotove').classList.add('on');
};

// ---------- kartou → PayPhone ----------
function odkazPayPhone(castka) {
  switch (nast.rezim) {
    case 'android':
      return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;` +
             `package=${ANDROID_PACKAGE};end`;
    case 'ios':
      return `shortcuts://run-shortcut?name=${encodeURIComponent(IOS_ZKRATKA)}&input=text&text=${castka}`;
    case 'sumup': {
      // SumUp Payment API pro mobilní web (github.com/sumup/sumup-android-api, sumup-ios-url-scheme);
      // SumUp dostane jen částku a ID platby, položky zůstávají v telefonu
      const zpet = location.origin + location.pathname + '?sumup=1';
      const q = new URLSearchParams({
        'affiliate-key': nast.sumupKlic, 'app-id': nast.sumupAppId,
        total: castka.toFixed(2), amount: castka.toFixed(2), currency: 'CZK', title: 'GN Bar',
        'foreign-tx-id': platbaKartou ? platbaKartou.id : 'test-' + Date.now(),
        'skip-screen-success': 'true', callback: zpet, callbacksuccess: zpet, callbackfail: zpet
      });
      return 'sumupmerchant://pay/1.0?' + q.toString().replace(/\+/g, '%20');
    }
    case 'vlastni':
      return nast.vlastni.replaceAll('{castka}', castka).replaceAll('{haleru}', castka * 100);
    default: return null;
  }
}

function otevriPayPhone(castka) {
  const u = odkazPayPhone(castka);
  if (u) location.href = u;
}

$('#btnKartou').onclick = async () => {
  const s = soucet();
  platbaKartou = { castka: s, id: 'gn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), ucet: { ...ucet } };
  // stránka se po návratu ze SumUpu načte znovu → rozpracovaný účet si uložit
  localStorage.setItem(K.cekajici, JSON.stringify(platbaKartou));
  $('#kCastka').textContent = kc(s);
  $('#kSchranka').textContent = '';
  $('#kNadpis').textContent = nast.rezim === 'sumup' ? 'Platba v SumUpu' : 'Zadej v PayPhone';
  if (nast.rezim === 'sumup' && !nast.sumupKlic) return toast('Chybí SumUp klíč v nastavení ⚙︎', true);
  try { await navigator.clipboard.writeText(String(s)); $('#kSchranka').textContent = `Částka ${s} je ve schránce`; } catch (e) {}
  $('#kOtevrit').style.display = nast.rezim === 'nic' ? 'none' : '';
  $('#dlgKarta').classList.add('on');
  otevriPayPhone(s);
};
$('#kOtevrit').onclick = () => platbaKartou && otevriPayPhone(platbaKartou.castka);
$('#kAno').onclick = () => { const c = platbaKartou.castka; konecKarty(); zaznamenej('karta', c); };
$('#kNe').onclick = () => { konecKarty(); toast('Platba neprošla — účet zůstal otevřený', true); };
function konecKarty() { platbaKartou = null; localStorage.removeItem(K.cekajici); zavri(); }

// návrat ze SumUpu: ?sumup=1&smp-status=success|failed&smp-tx-code=…&foreign-tx-id=…
function navratZeSumUp() {
  const q = new URLSearchParams(location.search);
  const cek = JSON.parse(localStorage.getItem(K.cekajici) || 'null');
  if (!q.has('sumup')) {
    if (cek) {  // nedokončená platba: ukázat dialog, ale SumUp znovu neotvírat
      ucet = cek.ucet; platbaKartou = cek; prekresli();
      $('#kCastka').textContent = kc(cek.castka); $('#kOtazka').textContent = 'Prošla platba ' + kc(cek.castka) + '?';
      $('#dlgKarta').classList.add('on');
    }
    return;
  }
  history.replaceState(null, '', location.pathname);
  if (!cek || (q.get('foreign-tx-id') && q.get('foreign-tx-id') !== cek.id)) return;
  localStorage.removeItem(K.cekajici);
  ucet = cek.ucet;
  if (q.get('smp-status') === 'success') zaznamenej('karta', cek.castka, null, q.get('smp-tx-code'));
  else { prekresli(); toast('Platba kartou neprošla — účet zůstal otevřený', true); }
}

// po návratu z PayPhone zvýraznit otázku
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && platbaKartou) { $('#kOtazka').textContent = 'Prošla platba ' + kc(platbaKartou.castka) + '?'; vibr(); }
});

$('#btnZrusit').onclick = () => { if (soucet() && confirm('Zrušit rozpracovaný účet?')) { ucet = {}; prekresli(); } };
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => konecKarty());
function zavri() { document.querySelectorAll('.overlay').forEach(o => o.classList.remove('on')); }

// ---------- přehled ----------
function vykresliPrehled() {
  const ok = prodeje.filter(p => !p.storno);
  const sum = z => ok.filter(p => !z || p.z === z).reduce((s, p) => s + p.c, 0);
  const n = z => ok.filter(p => !z || p.z === z).length;
  $('#sCelkem').textContent = kc(sum()); $('#sPocet').textContent = n() + ' účtů';
  $('#sHotove').textContent = kc(sum('hotove')); $('#sHotoveN').textContent = n('hotove') + ' účtů';
  $('#sKarta').textContent = kc(sum('karta')); $('#sKartaN').textContent = n('karta') + ' účtů';

  const agg = {};
  for (const p of ok) for (const o of p.o) {
    agg[o.n] = agg[o.n] || { q: 0, c: 0 }; agg[o.n].q += o.q; agg[o.n].c += o.q * o.p;
  }
  $('#tPolozky').innerHTML = Object.entries(agg).sort((a, b) => b[1].q - a[1].q)
    .map(([n, a]) => `<tr><td>${esc(n)}</td><td>${a.q}×</td><td>${kc(a.c)}</td></tr>`).join('') ||
    '<tr><td class="hint">Zatím nic</td></tr>';

  const u = $('#ucty'); u.innerHTML = '';
  for (const p of prodeje.slice(-40).reverse()) {
    const d = document.createElement('div'); d.className = 'uc' + (p.storno ? ' storno' : '');
    d.innerHTML = `<span class="t">${new Date(p.t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="o">${p.o.map(o => o.q + '× ' + esc(o.n)).join(', ')}</span>
      <span class="s ${p.z === 'karta' ? 'k' : 'h'}">${kc(p.c)}</span>`;
    const b = document.createElement('button'); b.textContent = p.storno ? '↺' : '✕';
    b.onclick = () => {
      if (!p.storno && !confirm(`Stornovat účet ${kc(p.c)}?` + (p.z === 'karta' ? '\nKartu je potřeba vrátit i v appce terminálu.' : ''))) return;
      p.storno = !p.storno; localStorage.setItem(K.prodeje, JSON.stringify(prodeje)); vykresliPrehled();
    };
    d.appendChild(b); u.appendChild(d);
  }
}

$('#btnExport').onclick = async () => {
  const rows = [['cas', 'barman', 'zpusob', 'castka', 'zakaznik_dal', 'polozky', 'storno', 'kod_transakce']];
  for (const p of prodeje) rows.push([new Date(p.t).toLocaleString('cs-CZ'), p.b, p.z, p.c, p.dal || '',
    p.o.map(o => o.q + 'x ' + o.n).join(' | '), p.storno ? 'ano' : '', p.tx || '']);
  const csv = '﻿' + rows.map(r => r.map(x => `"${String(x).replaceAll('"', '""')}"`).join(';')).join('\n');
  const jmeno = `gn-bar-${(nast.barman || 'bar').replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  const f = new File([csv], jmeno, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: jmeno }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = jmeno; a.click();
};

$('#btnUzaverka').onclick = () => {
  if (!prodeje.length) return;
  if (!confirm('Uzávěrka smaže všechny účty v tomhle telefonu. Exportoval jsi CSV?')) return;
  if (prompt('Pro potvrzení napiš SMAZAT') !== 'SMAZAT') return;
  prodeje = []; localStorage.setItem(K.prodeje, '[]'); vykresliPrehled();
};

// ---------- nastavení ----------
const HINTY = {
  sumup: 'Kartou otevře SumUp s vyplněnou částkou; po zaplacení se SumUp sám vrátí a platba se zapíše. Na iPhonu kasu používej v Safari (ne z plochy), jinak se návrat otevře jinde.',
  android: 'Tlačítko Kartou otevře appku PayPhone a částku dá do schránky. Kdyby se místo appky otevřel Obchod Play, ťukni tam na Otevřít.',
  ios: 'Jednou v appce Zkratky vytvoř zkratku s názvem „PayPhone“ s jedinou akcí Otevřít aplikaci → PayPhone. Kasa ji pak spustí sama.',
  vlastni: 'Pro případ, že KB SmartPay dodá odkaz s částkou (deep link).',
  nic: 'Appka jen ukáže velkou částku, PayPhone otevřeš ručně.'
};
function vyplnNastaveni() {
  $('#inBarman').value = nast.barman; $('#inRezim').value = nast.rezim;
  $('#inVlastni').value = nast.vlastni; $('#inCenik').value = nast.cenik;
  $('#inSumupKlic').value = nast.sumupKlic; $('#inSumupApp').value = nast.sumupAppId; rezimUI();
}
function rezimUI() {
  $('#lbVlastni').style.display = $('#inRezim').value === 'vlastni' ? '' : 'none';
  $('#boxSumup').style.display = $('#inRezim').value === 'sumup' ? '' : 'none';
  $('#hintRezim').textContent = HINTY[$('#inRezim').value];
}
$('#inRezim').onchange = rezimUI;
$('#btnUlozit').onclick = () => {
  nast = { barman: $('#inBarman').value.trim(), rezim: $('#inRezim').value,
           vlastni: $('#inVlastni').value.trim(), cenik: $('#inCenik').value.trim(),
           sumupKlic: $('#inSumupKlic').value.trim(), sumupAppId: $('#inSumupApp').value.trim() };
  localStorage.setItem(K.nast, JSON.stringify(nast));
  nactiCenik(); ucet = {}; prekresli(); hlavicka(); toast('Uloženo ✓');
};
$('#btnVychozi').onclick = () => { $('#inCenik').value = VYCHOZI_CENIK; };
$('#btnTest').onclick = () => { const r = nast.rezim; nast.rezim = $('#inRezim').value; otevriPayPhone(1); nast.rezim = r; };

// ---------- záložky, drobnosti ----------
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button, .tab').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); $('#' + b.dataset.tab).classList.add('on');
  document.body.classList.toggle('bezUctu', b.dataset.tab !== 'prodej');
  if (b.dataset.tab === 'prehled') vykresliPrehled();
  if (b.dataset.tab === 'nastaveni') vyplnNastaveni();
});
function hlavicka() { $('#barman').textContent = nast.barman; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
function vibr() { navigator.vibrate && navigator.vibrate(15); }
let tt; function toast(t, err) {
  const el = $('#toast'); el.textContent = t; el.style.background = err ? 'var(--red)' : '';
  el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 1800);
}

// nastavení SumUpu odkazem / QR kódem: ?klic=AFFILIATE-KEY&app=APP-ID
(() => {
  const q = new URLSearchParams(location.search);
  if (!q.has('klic')) return;
  Object.assign(nast, { rezim: 'sumup', sumupKlic: q.get('klic'), sumupAppId: q.get('app') || nast.sumupAppId });
  localStorage.setItem(K.nast, JSON.stringify(nast));
  history.replaceState(null, '', location.pathname);
  setTimeout(() => toast('SumUp nastaven ✓'), 300);
})();

nactiCenik(); prekresli(); hlavicka();
navratZeSumUp();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
