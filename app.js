// GN Bar — rychlá kasa pro barmany: položky → hotově / kartou (SumUp, případně PayPhone od KB SmartPay)
'use strict';

const VYCHOZI_CENIK = `Drinky 0,3 l; Křídla; 120
Drinky 0,3 l; Vodka džus; 120
Drinky 0,3 l; Vodka Sprite; 120
Drinky 0,3 l; Morgan a cola; 120
Drinky 0,3 l; Skinny Bitch; 120
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

// profily ceníku z QR (?cenik=…): výběr a pořadí kategorií výchozího ceníku
const PROFILY = {
  plny: {},
  vycep: { prvni: ['Pivo a nealko'], bez: ['Kýbl 5 l'] },
  bezkyblu: { bez: ['Kýbl 5 l'] },
  rychla: { jen: ['Pivo a nealko', 'Panáky'], prvni: ['Pivo a nealko'] }
};
function cenikProfilu(jmeno) {
  const pr = PROFILY[jmeno] || {}, kat = l => l.split(';')[0].trim();
  let r = VYCHOZI_CENIK.split('\n');
  if (pr.jen) r = r.filter(l => pr.jen.includes(kat(l)));
  if (pr.bez) r = r.filter(l => !pr.bez.includes(kat(l)));
  if (pr.prvni) r = [...r.filter(l => pr.prvni.includes(kat(l))), ...r.filter(l => !pr.prvni.includes(kat(l)))];
  return r.join('\n');
}

// Android: package appky PayPhone z Google Play (eu.softpos.softposwrapper.kb)
const ANDROID_PACKAGE = 'eu.softpos.softposwrapper.kb';
const IOS_ZKRATKA = 'PayPhone';

const K = { nast: 'gnbar.nastaveni', prodeje: 'gnbar.prodeje', cekajici: 'gnbar.cekajici',
            ucet: 'gnbar.ucet', nesparovane: 'gnbar.nesparovane' };
const $ = s => document.querySelector(s);
const kc = n => n.toLocaleString('cs-CZ') + ' Kč';
const novyId = () => 'gn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

// ---------- úložiště ----------
// poškozená data nesmí appku zabít: původní text odložit stranou a jet dál
function cti(k, def) {
  const raw = localStorage.getItem(k);
  if (raw == null) return def;
  try { const v = JSON.parse(raw); return v == null ? def : v; }
  catch (e) { try { localStorage.setItem(k + '.poskozene-' + Date.now(), raw); } catch (e2) {} return def; }
}
function pis(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { toast('Nepodařilo se uložit do telefonu!', true); return false; }
}
// účty se vždy znovu načtou a jen doplní podle id — jiná záložka tak nic nepřepíše ani nezdvojí
function nactiProdeje() {
  const a = cti(K.prodeje, []);
  return Array.isArray(a) ? a.map(p => p.id ? p : Object.assign(p, { id: 't' + p.t })) : [];
}
function pridejProdej(p) {
  const a = nactiProdeje();
  if (!a.some(x => x.id === p.id)) a.push(p);
  pis(K.prodeje, a); prodeje = a;
}
function upravProdej(id, fn) {
  const a = nactiProdeje(), p = a.find(x => x.id === id);
  if (p) { fn(p); pis(K.prodeje, a); }
  prodeje = a;
}

let nast = nactiNastaveni();
let prodeje = nactiProdeje();
let ucet = {};            // klíč položky → počet
let t0 = null;            // první ťuknutí rozpracovaného účtu
let polozky = [];         // [{kat, n, p}]
let platbaKartou = null;  // rozpracovaná platba kartou (kopie gnbar.cekajici)

function nactiNastaveni() {
  const n = cti(K.nast, {});
  return Object.assign({ barman: '', bar: '', profil: 'plny', rezim: odhadRezim(), vlastni: '', sumupKlic: '', sumupAppId: '', cenik: VYCHOZI_CENIK },
    typeof n === 'object' ? n : {});
}
function odhadRezim() { return /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : 'android'; }

// ---------- ceník ----------
const klic = p => p.kat + '\u0001' + p.n;
function rozeberCenik(text) {
  const ok = [], chyby = [], videno = new Set();
  String(text).split('\n').forEach((r, i) => {
    if (!r.trim()) return;
    const c = r.split(';').map(x => x.trim());
    const p = Number(String(c[2] || '').replace(/\s/g, '').replace(',', '.'));
    if (c.length < 3 || !c[0] || !c[1] || c[2] === '' || !Number.isInteger(p) || p < 0) return chyby.push(`řádek ${i + 1}: ${r.trim()}`);
    const pol = { kat: c[0], n: c[1], p };
    if (videno.has(klic(pol))) return chyby.push(`řádek ${i + 1}: ${r.trim()} (podruhé)`);
    videno.add(klic(pol)); ok.push(pol);
  });
  return { ok, chyby };
}
function nactiCenik() { polozky = rozeberCenik(nast.cenik).ok; }
const polozka = k => polozky.find(p => klic(p) === k);

function vykresliMenu() {
  const m = $('#menu'); m.innerHTML = '';
  const kat = [...new Set(polozky.map(p => p.kat))];
  for (const k of kat) {
    m.insertAdjacentHTML('beforeend', `<div class="kat">${esc(k)}</div>`);
    const g = document.createElement('div'); g.className = 'grid';
    for (const p of polozky.filter(x => x.kat === k)) {
      const b = document.createElement('button'); b.className = 'item';
      const q = ucet[klic(p)];
      b.innerHTML = `<span class="n">${esc(p.n)}</span><span class="p">${p.p} Kč</span>` + (q ? `<span class="q">${q}</span>` : '');
      b.onclick = () => {
        if (platbaKartou) return;
        if (!t0) t0 = Date.now();
        ucet[klic(p)] = (ucet[klic(p)] || 0) + 1; ulozUcet(); vibr(); prekresli();
      };
      g.appendChild(b);
    }
    m.appendChild(g);
  }
}

// ---------- účet ----------
const soucet = () => Object.entries(ucet).reduce((s, [k, q]) => s + (polozka(k) || { p: 0 }).p * q, 0);
const polozkyUctu = () => Object.entries(ucet).filter(([k]) => polozka(k))
  .map(([k, q]) => { const p = polozka(k); return { kat: p.kat, n: p.n, q, p: p.p }; });

function ulozUcet() {
  if (Object.keys(ucet).length) pis(K.ucet, { u: ucet, t0 }); else localStorage.removeItem(K.ucet);
}
function nactiUcet(zdroj) {
  ucet = {}; t0 = null;
  if (!zdroj || typeof zdroj.u !== 'object') return;
  for (const [k, q] of Object.entries(zdroj.u)) if (polozka(k) && q > 0) ucet[k] = q;
  t0 = zdroj.t0 || null;
}
function vycistiUcet() { ucet = {}; t0 = null; localStorage.removeItem(K.ucet); prekresli(); }

function vykresliUcet() {
  const el = $('#polozkyUctu'); el.innerHTML = '';
  for (const [k, q] of Object.entries(ucet)) {
    const p = polozka(k); if (!p) continue;
    const c = document.createElement('button'); c.className = 'chip';
    c.innerHTML = `<b>${q}×</b> ${esc(p.n)} <span class="minus">−</span>`;
    c.onclick = () => { if (platbaKartou) return; if (--ucet[k] <= 0) delete ucet[k]; if (!Object.keys(ucet).length) t0 = null; ulozUcet(); prekresli(); };
    el.appendChild(c);
  }
  const s = soucet();
  $('#total').textContent = kc(s);
  $('#btnHotove').disabled = $('#btnKartou').disabled = s === 0;
}

function prekresli() { vykresliMenu(); vykresliUcet(); }

function zaznamenej(z, c, x) {
  x = x || {};
  pridejProdej({ id: x.id || novyId(), t: Date.now(), t0: x.t0 || t0 || Date.now(), tk: x.tk || null, z, c,
    dal: x.dal || null, tx: x.tx || null, ftx: x.ftx || null, zapis: x.zapis || '',
    o: x.o || polozkyUctu(), b: nast.barman, bar: nast.bar || '' });
  vycistiUcet();
  if (z === 'karta') localStorage.removeItem(K.cekajici);  // až po zápisu účtu
}

// ---------- hotově ----------
$('#btnHotove').onclick = () => {
  if (platbaKartou) return;
  const s = soucet(); if (!s) return;
  let dal = null;
  $('#hCastka').textContent = kc(s); $('#hVratit').textContent = '';
  const g = $('#hDal'); g.innerHTML = '';
  for (const x of [s, 100, 200, 500, 1000, 2000].filter((x, i, a) => a.indexOf(x) === i && (i === 0 || x > s))) {
    const b = document.createElement('button'); b.textContent = x === s ? 'Přesně' : x.toLocaleString('cs-CZ');
    b.onclick = () => {
      dal = x; g.querySelectorAll('button').forEach(y => y.classList.toggle('on', y === b));
      $('#hVratit').textContent = x > s ? 'VRÁTIT ' + kc(x - s) : 'Bez vracení';
    };
    g.appendChild(b);
  }
  $('#hOk').onclick = () => { $('#hOk').onclick = null; zavri(); zaznamenej('hotove', s, { dal }); toast('Hotově ' + kc(s) + ' ✓'); };
  $('#dlgHotove').classList.add('on');
};

// ---------- kartou ----------
function odkazTerminal(castka, ftx) {
  switch (nast.rezim) {
    case 'android':
      return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;` +
             `package=${ANDROID_PACKAGE};end`;
    case 'ios':
      return `shortcuts://run-shortcut?name=${encodeURIComponent(IOS_ZKRATKA)}&input=text&text=${castka}`;
    case 'sumup': {
      // SumUp Payment API pro mobilní web (github.com/sumup/sumup-android-api, sumup-ios-url-scheme);
      // SumUp dostane jen částku, název a ID platby, položky zůstávají v telefonu
      const zpet = location.origin + location.pathname + '?sumup=1';
      const q = new URLSearchParams({
        'affiliate-key': nast.sumupKlic, 'app-id': nast.sumupAppId,
        total: castka.toFixed(2), amount: castka.toFixed(2), currency: 'CZK',
        title: ('GN Bar ' + (nast.bar || nast.barman)).trim().slice(0, 30),
        'foreign-tx-id': ftx || 'test-' + Date.now(), 'skip-screen-success': 'true',
        callback: zpet, callbacksuccess: zpet + '&ok=1', callbackfail: zpet + '&ok=0'
      });
      return 'sumupmerchant://pay/1.0?' + q.toString().replace(/\+/g, '%20');
    }
    case 'vlastni':
      return nast.vlastni.replaceAll('{castka}', castka).replaceAll('{haleru}', castka * 100);
    default: return null;
  }
}

// každé otevření terminálu = nové foreign-tx-id (SumUp stejné ID podruhé odmítne)
function otevriTerminal() {
  if (!platbaKartou) return;
  const ftx = platbaKartou.id + '-' + (platbaKartou.ftx.length + 1);
  platbaKartou.ftx.push(ftx);
  pis(K.cekajici, platbaKartou);  // stránka se po návratu načte znovu, třeba v nové záložce
  const u = odkazTerminal(platbaKartou.castka, ftx);
  if (u) location.href = u;
}

function ukazKartu(cek, poNavratu) {
  platbaKartou = cek;
  nactiUcet({ u: cek.ucet, t0: cek.t0 }); prekresli();
  $('#kCastka').textContent = kc(cek.castka);
  $('#kNadpis').textContent = nast.rezim === 'sumup' ? 'Platba v SumUpu' : 'Zadej v terminálu';
  $('#kSchranka').textContent = '';
  $('#kOtazka').textContent = poNavratu ? 'Prošla platba ' + kc(cek.castka) + '?' : 'Prošla platba?';
  $('#kOtevrit').style.display = nast.rezim === 'nic' ? 'none' : '';
  $('#dlgKarta').classList.add('on');
}

$('#btnKartou').onclick = () => {
  if (platbaKartou) return;  // dvojí ťuknutí
  const s = soucet(); if (!s) return;
  if (nast.rezim === 'sumup' && !nast.sumupKlic) return toast('Chybí SumUp klíč v nastavení ⚙︎', true);
  ukazKartu({ id: novyId(), castka: s, ucet: { ...ucet }, o: polozkyUctu(), t0: t0 || Date.now(), tk: Date.now(), ftx: [] }, false);
  otevriTerminal();  // synchronně v ťuknutí, jinak Safari přechod do SumUpu zablokuje
  if (nast.rezim !== 'sumup' && navigator.clipboard)
    navigator.clipboard.writeText(String(s)).then(() => { $('#kSchranka').textContent = `Částka ${s} je ve schránce`; }, () => {});
};
$('#kOtevrit').onclick = otevriTerminal;
$('#kAno').onclick = () => {
  const cek = cti(K.cekajici, null);
  if (!platbaKartou || !cek || cek.id !== platbaKartou.id) {
    platbaKartou = null; zavri(); synchronizuj();
    return toast('Platba už je vyřízená v jiném okně');
  }
  platbaKartou = null; zavri();
  zaznamenej('karta', cek.castka, { id: cek.id, o: cek.o, t0: cek.t0, tk: cek.tk, ftx: cek.ftx[cek.ftx.length - 1], zapis: 'rucne' });
  potvrzeni(cek.castka);
};
$('#kNe').onclick = () => { zrusKartu(); toast('Platba neprošla — účet zůstal otevřený', true); };
$('#kZpet').onclick = zrusKartu;
function zrusKartu() { platbaKartou = null; localStorage.removeItem(K.cekajici); zavri(); }

// SumUp někdy přilepí parametry za další „?“ — sjednotit
function parametry() {
  return new URLSearchParams((location.search.replace(/^\?/, '') + '&' + location.hash.replace(/^#/, '')).replace(/\?/g, '&'));
}

// návrat ze SumUpu: ?sumup=1[&ok=1|0]&smp-status=success|failed|invalidstate&smp-tx-code=…&foreign-tx-id=…
function navratZeSumUp() {
  const q = parametry();
  const cek = cti(K.cekajici, null);
  if (!q.has('sumup') && !q.has('smp-status')) { if (cek) ukazKartu(cek, true); return; }
  history.replaceState(null, '', location.pathname);
  const stav = q.get('smp-status') || (q.get('ok') === '1' ? 'success' : q.get('ok') === '0' ? 'failed' : '');
  const tx = q.get('smp-tx-code') || '', ftx = q.get('foreign-tx-id') || '';
  const patri = !!cek && (!ftx || (cek.ftx || []).includes(ftx));

  if (stav === 'success') {
    if (patri) {
      zaznamenej('karta', cek.castka, { id: cek.id, o: cek.o, t0: cek.t0, tk: cek.tk, ftx: ftx || cek.ftx[cek.ftx.length - 1], tx, zapis: 'auto' });
      platbaKartou = null;
      return potvrzeni(cek.castka);
    }
    // už zapsáno (znovu načtená stránka, nebo ručně v jiném okně) → jen doplnit kód transakce
    const uz = nactiProdeje().find(p => (tx && p.tx === tx) || (ftx && p.ftx === ftx));
    if (uz) { if (!uz.tx && tx) upravProdej(uz.id, p => { p.tx = tx; }); return; }
    const n = cti(K.nesparovane, []); (Array.isArray(n) ? n : []).push({ t: Date.now(), tx, ftx });
    pis(K.nesparovane, n);
    return info('Platba kartou bez účtu',
      `SumUp hlásí zaplacenou platbu${tx ? ' (kód ' + tx + ')' : ''}, ale v kase k ní není otevřený účet. ` +
      'Zkontroluj Přehled. Když tam účet chybí, řekni to vedoucímu — platbu nepiš znovu kartou.');
  }
  if (!patri) { if (cek) ukazKartu(cek, true); return; }
  if (stav === 'failed') {
    localStorage.removeItem(K.cekajici); platbaKartou = null;
    nactiUcet({ u: cek.ucet, t0: cek.t0 }); ulozUcet(); prekresli();
    const proc = q.get('smp-failure-cause');
    return toast('Platba kartou neprošla' + (proc ? ' (' + proc + ')' : '') + ' — účet zůstal otevřený', true, 4000);
  }
  if (stav === 'invalidstate') {
    localStorage.removeItem(K.cekajici); platbaKartou = null;
    nactiUcet({ u: cek.ucet, t0: cek.t0 }); ulozUcet(); prekresli();
    return info('SumUp není připravený', 'Platba neproběhla. V appce SumUp se přihlas a zapni Tap to Pay, pak dej znovu Kartou.');
  }
  ukazKartu(cek, true);  // neznámý výsledek → zeptat se barmana
}

// ---------- synchronizace mezi záložkami ----------
// návrat ze SumUpu otevírá novou záložku; ta stará se musí srovnat s tím, co je uložené
function synchronizuj() {
  nast = nactiNastaveni(); nactiCenik(); hlavicka();
  prodeje = nactiProdeje();
  const cek = cti(K.cekajici, null);
  if (platbaKartou && (!cek || cek.id !== platbaKartou.id)) { platbaKartou = null; $('#dlgKarta').classList.remove('on'); }
  if (!platbaKartou) nactiUcet(cti(K.ucet, null));
  prekresli();
  if ($('#prehled').classList.contains('on')) vykresliPrehled();
}
window.addEventListener('storage', e => { if (!e.key || e.key.startsWith('gnbar.')) synchronizuj(); });
window.addEventListener('pageshow', e => { if (e.persisted) synchronizuj(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  synchronizuj();
  if (platbaKartou) { $('#kOtazka').textContent = 'Prošla platba ' + kc(platbaKartou.castka) + '?'; vibr(); }
});

$('#btnZrusit').onclick = () => { if (!platbaKartou && soucet() && confirm('Zrušit rozpracovaný účet?')) vycistiUcet(); };
document.querySelectorAll('[data-close]').forEach(b => b.onclick = zavri);
function zavri() { document.querySelectorAll('.overlay').forEach(o => o.classList.remove('on')); }

// celoobrazovkové potvrzení karty (toast by barman přehlédl)
let tOk;
function potvrzeni(castka) {
  $('#okCastka').textContent = kc(castka);
  $('#dlgOk').classList.add('on'); vibr();
  clearTimeout(tOk); tOk = setTimeout(() => $('#dlgOk').classList.remove('on'), 3500);
}
$('#dlgOk').onclick = () => $('#dlgOk').classList.remove('on');
function info(nadpis, text) {
  $('#iNadpis').textContent = nadpis; $('#iText').textContent = text;
  $('#dlgInfo').classList.add('on'); vibr();
}

// ---------- přehled ----------
function vykresliPrehled() {
  prodeje = nactiProdeje();
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

  const nes = cti(K.nesparovane, []);
  $('#nesparovane').textContent = Array.isArray(nes) && nes.length ? `Pozor: ${nes.length}× platba kartou bez účtu (je v exportu) — nahlas vedoucímu.` : '';

  const u = $('#ucty'); u.innerHTML = '';
  for (const p of prodeje.slice(-40).reverse()) {
    const d = document.createElement('div'); d.className = 'uc' + (p.storno ? ' storno' : '');
    d.innerHTML = `<span class="t">${new Date(p.t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="o">${p.o.map(o => o.q + '× ' + esc(o.n)).join(', ')}</span>
      <span class="s ${p.z === 'karta' ? 'k' : 'h'}">${kc(p.c)}</span>`;
    const b = document.createElement('button'); b.textContent = p.storno ? '↺' : '✕';
    b.onclick = () => {
      if (!p.storno && !confirm(`Stornovat účet ${kc(p.c)}?` + (p.z === 'karta' ? '\nPeníze na kartu vrátí vedoucí v SumUpu.' : ''))) return;
      upravProdej(p.id, x => { x.storno = !x.storno; x.st = x.storno ? Date.now() : null; });
      vykresliPrehled();
    };
    d.appendChild(b); u.appendChild(d);
  }
}

// ---------- export ----------
const iso = t => t ? new Date(t).toISOString() : '';
const sekundy = (a, b) => a && b ? Math.round((b - a) / 100) / 10 : '';
// apostrof před = + - @, ať Excel nespouští vzorce
const bunka = x => { let s = String(x == null ? '' : x); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replaceAll('"', '""')}"`; };
const csv = rows => '﻿' + rows.map(r => r.map(bunka).join(';')).join('\n');
const jmenoSouboru = druh => `gn-bar-${(nast.bar || nast.barman || 'bar').replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}-${druh}.csv`;

async function sdilej(text, jmeno) {
  const f = new File([text], jmeno, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: jmeno }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = jmeno; a.click();
}

$('#btnExport').onclick = () => {
  prodeje = nactiProdeje();
  const rows = [['id', 'cas_iso', 'cas', 'telefon', 'barman', 'zpusob', 'castka', 'zakaznik_dal', 'vratit', 'polozky', 'pocet_polozek',
    'doba_s', 'doba_karty_s', 't0_iso', 'storno', 'storno_cas', 'kod_transakce', 'foreign_tx_id', 'zpusob_zapisu']];
  for (const p of prodeje) rows.push([p.id, iso(p.t), new Date(p.t).toLocaleString('cs-CZ'), p.bar || '', p.b || '', p.z, p.c,
    p.dal || '', p.dal ? p.dal - p.c : '', p.o.map(o => `${o.q}×${o.n}@${o.p}`).join(' | '), p.o.reduce((s, o) => s + o.q, 0),
    sekundy(p.t0, p.t), sekundy(p.tk, p.t), iso(p.t0), p.storno ? 'ano' : '', iso(p.st), p.tx || '', p.ftx || '', p.zapis || '']);
  const nes = cti(K.nesparovane, []);
  for (const x of Array.isArray(nes) ? nes : []) rows.push(['', iso(x.t), new Date(x.t).toLocaleString('cs-CZ'), nast.bar || '', nast.barman,
    'karta_bez_uctu', '', '', '', '', '', '', '', '', '', '', x.tx || '', x.ftx || '', 'auto']);
  sdilej(csv(rows), jmenoSouboru('ucty'));
};
$('#btnExportPolozky').onclick = () => {
  prodeje = nactiProdeje();
  const rows = [['id_uctu', 'cas_iso', 'telefon', 'barman', 'zpusob', 'kategorie', 'polozka', 'cena', 'ks', 'celkem', 'storno']];
  for (const p of prodeje) for (const o of p.o)
    rows.push([p.id, iso(p.t), p.bar || '', p.b || '', p.z, o.kat || '', o.n, o.p, o.q, o.p * o.q, p.storno ? 'ano' : '']);
  sdilej(csv(rows), jmenoSouboru('polozky'));
};

$('#btnUzaverka').onclick = () => {
  if (!nactiProdeje().length) return;
  if (!confirm('Uzávěrka smaže všechny účty v tomhle telefonu. Exportoval jsi CSV?')) return;
  if (prompt('Pro potvrzení napiš SMAZAT') !== 'SMAZAT') return;
  pis(K.prodeje, []); localStorage.removeItem(K.nesparovane); prodeje = []; vykresliPrehled();
};

// ---------- nastavení ----------
const HINTY = {
  sumup: 'Kartou otevře SumUp s vyplněnou částkou; po zaplacení se SumUp sám vrátí a platba se zapíše. Na iPhonu kasu používej v Safari (ne z plochy), jinak se návrat otevře jinde.',
  android: 'Tlačítko Kartou otevře appku PayPhone a částku dá do schránky. Kdyby se místo appky otevřel Obchod Play, ťukni tam na Otevřít.',
  ios: 'Jednou v appce Zkratky vytvoř zkratku s názvem „PayPhone“ s jedinou akcí Otevřít aplikaci → PayPhone. Kasa ji pak spustí sama.',
  vlastni: 'Pro případ, že KB SmartPay dodá odkaz s částkou (deep link).',
  nic: 'Appka jen ukáže velkou částku, terminál otevřeš ručně.'
};
function vyplnNastaveni() {
  $('#inBarman').value = nast.barman; $('#inBar').value = nast.bar; $('#inRezim').value = nast.rezim;
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
  if (platbaKartou) return toast('Nejdřív dokonči platbu kartou', true);
  const cenik = $('#inCenik').value.trim(), r = rozeberCenik(cenik);
  if (r.chyby.length) return alert('Ceník nejde uložit, oprav tyhle řádky (Kategorie; Název; Cena v celých Kč):\n\n' + r.chyby.join('\n'));
  if (!r.ok.length) return alert('Ceník je prázdný.');
  nast = Object.assign(nast, { barman: $('#inBarman').value.trim(), bar: $('#inBar').value.trim(), rezim: $('#inRezim').value,
           vlastni: $('#inVlastni').value.trim(), cenik,
           sumupKlic: $('#inSumupKlic').value.trim(), sumupAppId: $('#inSumupApp').value.trim() });
  pis(K.nast, nast);
  nactiCenik(); nactiUcet({ u: ucet, t0 }); ulozUcet(); prekresli(); hlavicka(); toast('Uloženo ✓');
};
$('#btnVychozi').onclick = () => { $('#inCenik').value = cenikProfilu(nast.profil); };
$('#btnTest').onclick = () => {
  const r = nast.rezim; nast.rezim = $('#inRezim').value;
  const u = odkazTerminal(1); nast.rezim = r;
  if (u) location.href = u;
};

// ---------- záložky, drobnosti ----------
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button, .tab').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); $('#' + b.dataset.tab).classList.add('on');
  document.body.classList.toggle('bezUctu', b.dataset.tab !== 'prodej');
  if (b.dataset.tab === 'prehled') vykresliPrehled();
  if (b.dataset.tab === 'nastaveni') vyplnNastaveni();
});
function hlavicka() {
  $('#barman').textContent = [nast.bar, nast.barman !== nast.bar ? nast.barman : ''].filter(Boolean).join(' · ');
  // iPhone: kasa z plochy má vlastní data a návrat ze SumUpu do ní nevede
  $('#varovani').textContent = navigator.standalone && nast.rezim === 'sumup' ? 'Kasu otevři v Safari, ne z plochy — jinak se platby kartou nezapíšou.' : '';
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
function vibr() { navigator.vibrate && navigator.vibrate(15); }
let tt; function toast(t, err, ms) {
  const el = $('#toast'); el.textContent = t; el.style.background = err ? 'var(--red)' : '';
  el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), ms || (err ? 3000 : 1800));
}

// nastavení odkazem / QR kódem: ?klic=AFFILIATE-KEY&app=APP-ID&bar=bar07&cenik=plny|vycep|bezkyblu|rychla
(() => {
  const q = parametry();
  if (q.has('sumup') || !(q.has('klic') || q.has('bar') || q.has('cenik'))) return;
  if (q.has('klic')) Object.assign(nast, { rezim: 'sumup', sumupKlic: q.get('klic'), sumupAppId: q.get('app') || nast.sumupAppId });
  if (q.get('bar')) { nast.bar = q.get('bar').trim().slice(0, 20); if (!nast.barman) nast.barman = nast.bar; }
  const pr = q.get('cenik');
  if (pr && PROFILY[pr]) { nast.profil = pr; nast.cenik = cenikProfilu(pr); }
  pis(K.nast, nast);
  history.replaceState(null, '', location.pathname);
  setTimeout(() => toast('Nastaveno ✓' + (nast.bar ? ' ' + nast.bar : '')), 300);
})();

nactiCenik(); nactiUcet(cti(K.ucet, null)); prekresli(); hlavicka();
navratZeSumUp();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
