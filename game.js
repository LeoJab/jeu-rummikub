/* Rummikub – interface, réseau (salle du hub) et glisser-déposer.
 * Les règles sont dans rules.js, les effets dans fx.js.
 * Modèle réseau : un état complet et versionné envoyé avec keep:true par le joueur dont c'est le tour. */
(function () {
  'use strict';
  var R = window.Rules, FX = window.FX;
  var $ = function (s) { return document.querySelector(s); };
  var SYM = ['●', '▲', '■', '◆'];
  var MAXP = 4;
  var EMOJIS = ['👏', '😱', '😂', '🔥', '🤡', '😭', '🫡', '💀'];
  var hub = !!window.ChadGang;

  var net = null, myId = null, myName = '', myAvatar = null;
  var roomCode = null, roomPlayers = [], avatars = {};
  var S = null;          // dernier état validé
  var draft = null;      // table en cours de l'adversaire { v, table }
  var work = null, orig = null, history = []; // mon tour en cours
  var rackOrder = [];    // ordre de mon chevalet (persistant)
  var turnStart = 0, lastTick = 0, absentSince = 0;
  var popped = {}, finSent = null, drag = null, draftTimer = null, toastTimer = null, lastReact = 0;

  /* ================= Outils ================= */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2300);
  }
  function show(name) {
    ['home', 'lobby', 'game'].forEach(function (n) { $('#' + n).classList.toggle('hidden', n !== name); });
  }
  function myIdx() { return S ? S.pl.findIndex(function (p) { return p.id === myId; }) : -1; }
  function myTurn() { return !!(S && S.phase === 'play' && work && S.pl[S.turn] && S.pl[S.turn].id === myId); }
  function isHost() { return roomPlayers.length > 0 && roomPlayers[0].id === myId; }
  function rackArr() { return work ? work.rack : rackOrder; }

  function tileEl(id) {
    var t = R.info(id);
    var e = el('div', 'tile ' + (t.joker ? 'cj' : 'c' + t.c));
    e.dataset.id = id;
    var n = el('span', 'num', t.joker ? '☻' : String(t.n));
    var m = el('span', 'mk', t.joker ? 'JOKER' : SYM[t.c]);
    e.appendChild(n); e.appendChild(m);
    return e;
  }
  function avEl(id, name) {
    var a = el('div', 'av');
    a.setAttribute('data-chadgang-id', id);
    var url = id === myId ? myAvatar : avatars[id];
    if (url) { var im = el('img'); im.src = url; im.alt = ''; a.appendChild(im); }
    else a.textContent = (name || '?').trim().charAt(0).toUpperCase();
    return a;
  }

  /* ================= Accueil ================= */
  function buildLogo() {
    var logo = $('#logo');
    'RUMMIKUB'.split('').forEach(function (ch, i) {
      var t = el('div', 'tile c' + (i % 4));
      t.style.animationDelay = (i * 0.15) + 's';
      t.appendChild(el('span', 'num', ch));
      t.appendChild(el('span', 'mk', SYM[i % 4]));
      logo.appendChild(t);
    });
    var bg = $('#bgtiles');
    for (var i = 0; i < 16; i++) {
      var t = tileEl(Math.floor(Math.random() * 104));
      t.style.left = (Math.random() * 95) + '%';
      t.style.animationDuration = (10 + Math.random() * 14) + 's';
      t.style.animationDelay = (-Math.random() * 20) + 's';
      bg.appendChild(t);
    }
  }
  function homeErr(m) { $('#homeErr').textContent = m || ''; }
  function randomCode() {
    var l = 'ABCDEFGHJKLMNPQRSTUVWXYZ', c = '';
    for (var i = 0; i < 4; i++) c += l.charAt(Math.floor(Math.random() * l.length));
    return c;
  }

  async function init() {
    buildLogo();
    var name = '';
    if (hub) {
      try {
        var m = await ChadGang.me();
        myId = m.id; name = m.name; myAvatar = m.avatar;
      } catch (e) {}
    }
    if (!myId) {
      try { myId = sessionStorage.getItem('rkid'); } catch (e) {}
      if (!myId) {
        myId = 'l' + Math.random().toString(36).slice(2, 9);
        try { sessionStorage.setItem('rkid', myId); } catch (e) {}
      }
    }
    if (!name) { try { name = localStorage.getItem('rk_name') || ''; } catch (e) {} }
    myName = name;
    $('#pseudo').value = name;
    if (hub && name) {
      $('#pseudoField').classList.add('hidden');
      var h = $('#hello'); h.textContent = 'Salut ' + name + ' !'; h.classList.remove('hidden');
    }
    $('#mSound').textContent = FX.isMuted() ? '🔇 Son coupé' : '🔊 Son';
    var inv = null;
    try { inv = (hub && ChadGang.room && ChadGang.room()) || new URLSearchParams(location.search).get('room'); } catch (e) {}
    if (inv) { $('#code').value = inv.toUpperCase(); join(inv, true); }
  }

  /* ================= Salle / réseau ================= */
  function join(code, create) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { homeErr('Le code fait 4 à 12 lettres ou chiffres.'); return; }
    if (!hub || !myName) {
      myName = $('#pseudo').value.trim() || myName || ('Joueur' + Math.floor(Math.random() * 90 + 10));
      try { localStorage.setItem('rk_name', myName); } catch (e) {}
    }
    homeErr('');
    roomCode = code;
    net = hub ? ChadGang.join(code, { create: create }) : localJoin(code);
    net.on('ready', onReady);
    net.on('players', onPlayers);
    net.on('message', onMessage);
    net.on('error', function (msg) {
      homeErr(typeof msg === 'string' && msg ? msg : 'Salle introuvable.');
      leave();
    });
    FX.sound('pick');
    show('lobby');
    renderLobby();
  }

  function onReady(info) {
    info = info || {};
    if (info.me) myId = info.me;
    roomPlayers = info.players || roomPlayers;
    sendHi();
    if (info.last && info.last.t === 'state') applyState(info.last.s, { silent: true });
    else { show('lobby'); renderLobby(); }
  }
  function onPlayers(list) {
    roomPlayers = list || [];
    sendHi();
    if (S) renderChips(); else renderLobby();
  }
  function sendHi() { if (net) net.send({ t: 'hi', avatar: myAvatar || null }); }

  function onMessage(d, from) {
    if (!d || typeof d !== 'object' || !from) return;
    if (d.t === 'state') applyState(d.s, {});
    else if (d.t === 'draft') {
      if (from.id === myId || !S || d.v !== S.v) return;
      var cur = S.pl[S.turn];
      if (!cur || cur.id !== from.id || !Array.isArray(d.table)) return;
      draft = { v: d.v, table: d.table };
      renderChips(); renderTable();
    } else if (d.t === 'hi') {
      if (from.id !== myId && d.avatar) { avatars[from.id] = d.avatar; if (S) renderChips(); else renderLobby(); }
    } else if (d.t === 'react') {
      if (EMOJIS.indexOf(d.e) >= 0) FX.react(d.e, from.name);
    }
  }

  function renderLobby() {
    $('#roomCode').textContent = roomCode || '----';
    var box = $('#lobbyPlayers');
    box.textContent = '';
    roomPlayers.forEach(function (p, i) {
      var row = el('div', 'lp' + (i >= MAXP ? ' spec' : ''));
      row.appendChild(avEl(p.id, p.name));
      row.appendChild(el('span', 'nm', p.name + (p.id === myId ? ' (toi)' : '')));
      if (i === 0) row.appendChild(el('span', 'tag2', '👑 hôte'));
      if (i >= MAXP) row.appendChild(el('span', 'tag2', '👀 spectateur'));
      box.appendChild(row);
    });
    var host = isHost();
    $('#lobbyHost').classList.toggle('hidden', !host);
    $('#lobbyWait').classList.toggle('hidden', host);
    $('#btnStart').disabled = roomPlayers.length < 2;
    $('#btnStart').textContent = roomPlayers.length < 2 ? '⏳ En attente d’un 2e joueur…' : '🚀 Lancer la partie (' + Math.min(roomPlayers.length, MAXP) + ' joueurs)';
  }

  function startGame() {
    if (!isHost() || roomPlayers.length < 2) return;
    var tl = S && S.phase === 'over' ? S.tl : (+$('#optTime').value || 0);
    var ns = R.newGame(roomPlayers.slice(0, MAXP), { gid: roomCode + '-' + Date.now().toString(36), tl: tl });
    publish(ns);
  }

  function leave() {
    try { if (net) net.leave(); } catch (e) {}
    net = null; S = null; work = null; orig = null; draft = null; roomPlayers = []; roomCode = null;
    history = []; rackOrder = []; popped = {}; finSent = null;
    ['over', 'rules'].forEach(function (id) { $('#' + id).classList.add('hidden'); });
    show('home');
  }

  /* ================= État de partie ================= */
  function publish(ns) {
    if (net) net.send({ t: 'state', s: ns }, { keep: true });
    applyState(ns, { mine: true });
  }

  function applyState(s, o) {
    if (!s || typeof s.v !== 'number' || !Array.isArray(s.pl)) return;
    if (S && S.gid === s.gid && s.v <= S.v) return;
    var sameGame = S && S.gid === s.gid;
    if (!sameGame) { rackOrder = []; work = null; orig = null; history = []; popped = {}; finSent = null; $('#over').classList.add('hidden'); }
    S = s; draft = null; turnStart = Date.now(); lastTick = 0; absentSince = 0;
    cancelDrag();
    syncRack();
    var mine = S.phase === 'play' && myIdx() >= 0 && S.pl[S.turn].id === myId;
    if (mine) beginTurn(); else { work = null; orig = null; history = []; }
    show('game');
    if (!o.silent && !o.mine) playEvent(S.ev, S);
    if (o.mine) playEvent(S.ev, S);
    if (mine && !o.silent) notifyTurn();
    if (S.phase === 'over') showOver(!!o.silent);
    render();
  }

  function syncRack() {
    var mi = myIdx();
    if (mi < 0) { rackOrder = []; return; }
    var cur = S.racks[mi], have = {};
    cur.forEach(function (id) { have[id] = 1; });
    rackOrder = rackOrder.filter(function (id) { return have[id]; });
    var seen = {};
    rackOrder.forEach(function (id) { seen[id] = 1; });
    cur.forEach(function (id) { if (!seen[id]) rackOrder.push(id); });
  }

  function beginTurn() {
    orig = { table: R.clone(S.table), rack: rackOrder.slice() };
    work = { table: R.clone(S.table), rack: rackOrder };
    history = [];
  }
  function setWork(table, rack) {
    work.table = table.filter(function (s) { return s.length; });
    work.rack = rack;
    rackOrder = rack;
  }
  function notifyTurn() {
    FX.sound('turn'); FX.vibrate([60, 40, 60]);
    toast('🔥 À toi de jouer !');
    if (document.hidden) document.title = '🔥 À toi ! – Rummikub';
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) document.title = 'Rummikub – ChadGangGames'; });

  /* ================= Effets d'événements ================= */
  function playEvent(ev, s) {
    if (!ev) return;
    var who = s.pl[ev.by] ? s.pl[ev.by].name : '';
    var me = s.pl[ev.by] && s.pl[ev.by].id === myId;
    switch (ev.k) {
      case 'start':
        FX.sound('shuffle');
        FX.banner('C’EST PARTI !', s.pl.map(function (p) { return p.name; }).join(' · '), 'yellow');
        FX.burst(innerWidth / 2, innerHeight * 0.4, 50);
        break;
      case 'draw': FX.sound('draw'); if (!me) toast(who + ' pioche'); break;
      case 'skip': FX.sound('draw'); toast(who + ' est absent : il pioche'); break;
      case 'pass': toast(who + ' passe'); break;
      case 'play': playFx(ev, who, false); break;
      case 'win': playFx(ev, who, true); break;
      case 'block': FX.banner('PARTIE BLOQUÉE', 'Le plus petit chevalet l’emporte', 'white'); break;
    }
  }
  function playFx(ev, who, win) {
    var n = ev.n || 0, title = null, sub = '', tone = 'yellow', snd = 'ok', bn = 20, shake = false;
    if (!win && ev.left === 1) { title = 'PLUS QU’UNE TUILE !'; sub = who + ' est à un cheveu de la victoire'; tone = 'red'; snd = 'combo'; bn = 60; shake = true; }
    else if (ev.open) { title = 'OUVERTURE !'; sub = who + ' ouvre avec ' + ev.pts + ' points'; snd = 'combo'; bn = 70; }
    else if (n >= 6) { title = 'COUP DE GÉNIE !'; sub = n + ' tuiles d’un coup'; snd = 'combo'; bn = 90; shake = true; }
    else if (ev.jm) { title = 'JOKER VOLÉ !'; sub = who + ' récupère un joker'; snd = 'joker'; bn = 60; }
    else if (ev.jp) { title = 'JOKER !'; sub = who + ' sort le joker'; snd = 'joker'; bn = 50; }
    else if (ev.manip) { title = 'MANIPULATION !'; sub = 'La table a bougé…'; snd = 'combo'; bn = 60; shake = true; }
    else if (n >= 3) { title = 'BEAU COUP !'; sub = who + ' pose ' + n + ' tuiles'; bn = 35; }
    else if (!win) toast(who + ' pose ' + n + ' tuile' + (n > 1 ? 's' : ''));
    FX.sound(snd);
    if (title && !win) FX.banner(title, sub, tone);
    FX.burst(innerWidth / 2, innerHeight * 0.4, bn);
    if (shake) FX.shake();
  }

  /* ================= Fin de partie ================= */
  function showOver(silent) {
    var mi = myIdx(), win = S.win.indexOf(mi) >= 0;
    var names = S.win.map(function (i) { return S.pl[i].name; }).join(' & ');
    $('#overIcon').textContent = S.ev && S.ev.k === 'block' ? '🧱' : (win ? '🏆' : '🎉');
    $('#overTitle').textContent = win ? 'Victoire !' : names + ' gagne !';
    var box = $('#overRows');
    box.textContent = '';
    S.res.slice().sort(function (a, b) { return b.delta - a.delta; }).forEach(function (r) {
      var w = S.win.indexOf(r.i) >= 0;
      var row = el('div', 'orow' + (w ? ' w' : ''));
      row.appendChild(avEl(S.pl[r.i].id, S.pl[r.i].name));
      row.appendChild(el('span', 'nm', (w ? '👑 ' : '') + S.pl[r.i].name));
      row.appendChild(el('span', 'small', r.left + ' pts en main'));
      row.appendChild(el('span', 'pts', (r.delta > 0 ? '+' : '') + r.delta));
      box.appendChild(row);
    });
    $('#btnAgain').classList.toggle('hidden', !isHost());
    $('#againWait').textContent = isHost() ? '' : 'L’hôte peut relancer une partie.';
    $('#over').classList.remove('hidden');
    if (!silent) {
      setTimeout(function () {
        FX.sound(win ? 'win' : 'lose');
        FX.banner(win ? 'VICTOIRE !' : names + ' GAGNE !', win ? 'Tu règnes sur la table 👑' : 'Revanche ?', win ? 'yellow' : 'white');
        FX.confetti(win ? 260 : 120);
        FX.fireworks(win ? 9 : 4, 380);
        FX.vibrate(win ? [100, 50, 100, 50, 200] : 80);
      }, 700);
    }
    reportResult();
  }
  function reportResult() {
    var mi = myIdx();
    if (!window.ChadGang || !ChadGang.finPartie || mi < 0 || !S || S.phase !== 'over' || finSent === S.gid) return;
    finSent = S.gid;
    var win = S.win.indexOf(mi) >= 0;
    try {
      ChadGang.finPartie({ gagne: win, partie: S.gid, score: win ? Math.max(0, S.res[mi].delta) : 0 }).catch(function () {});
    } catch (e) {}
  }

  /* ================= Rendu ================= */
  function render() {
    if (!S) return;
    renderChips(); renderTable(); renderRack(); renderBottom();
  }

  function renderChips() {
    if (!S) return;
    var box = $('#chips');
    box.textContent = '';
    var baseIds = {}, placed = 0;
    S.table.forEach(function (st) { st.forEach(function (id) { baseIds[id] = 1; }); });
    if (draft && draft.v === S.v) draft.table.forEach(function (st) { st.forEach(function (id) { if (!baseIds[id]) placed++; }); });
    S.pl.forEach(function (p, i) {
      var turn = S.phase === 'play' && S.turn === i;
      var online = roomPlayers.some(function (r) { return r.id === p.id; });
      var c = el('div', 'chip' + (turn ? ' turn' : '') + (online ? '' : ' off'));
      c.appendChild(avEl(p.id, p.name));
      var who = el('div', 'who');
      who.appendChild(el('div', 'nm', p.name + (p.id === myId ? ' (toi)' : '')));
      var cnt = S.racks[i].length - (turn && p.id !== myId ? placed : 0);
      if (turn && p.id === myId && work) cnt = work.rack.length;
      who.appendChild(el('div', 'ct', '🎴 ' + cnt + (p.open ? ' 🔓' : ' 🔒')));
      c.appendChild(who);
      var bar = el('div', 'bar' + (S.tl && turn ? ' on' : ''));
      bar.appendChild(el('i'));
      c.appendChild(bar);
      box.appendChild(c);
    });
  }

  function renderTable() {
    if (!S) return;
    var T = $('#table');
    T.textContent = '';
    var isDraft = !work && draft && draft.v === S.v;
    var tbl = work ? work.table : (isDraft ? draft.table : S.table);
    var base = {}, fr = {};
    S.table.forEach(function (st) { st.forEach(function (id) { base[id] = 1; }); });
    (S.fr || []).forEach(function (id) { fr[id] = 1; });
    var canDrag = myTurn();
    tbl.forEach(function (set, si) {
      var d = el('div', 'set');
      d.dataset.si = si;
      if (work) {
        var a = R.analyse(set);
        d.classList.add(a.ok ? 'ok' : 'bad');
        if (a.ok) d.appendChild(el('span', 'val', String(a.value)));
      }
      if (canDrag) d.appendChild(el('div', 'grip', '⠿'));
      set.forEach(function (id) {
        var t = tileEl(id);
        if (fr[id] || (isDraft && !base[id])) t.classList.add('fresh');
        if (fr[id] && popped[id] !== S.v && !work) { t.classList.add('pop'); popped[id] = S.v; }
        d.appendChild(t);
      });
      T.appendChild(d);
    });
    $('#tableHint').textContent = tbl.length ? '' : (S.phase === 'play' ? 'La table est vide.\nGlisse tes tuiles ici pour créer une combinaison !' : '');
    $('#tableHint').style.whiteSpace = 'pre-line';
  }

  function renderRack() {
    var box = $('#rack');
    box.textContent = '';
    if (myIdx() < 0) { box.appendChild(el('div', 'small', '👀 Tu regardes la partie')); return; }
    rackArr().forEach(function (id) { box.appendChild(tileEl(id)); });
  }

  function renderBottom() {
    var mi = myIdx(), mine = myTurn(), playing = S.phase === 'play';
    var st = $('#status'), op = $('#open'), be = $('#btnEnd');
    st.className = mine ? 'mine' : '';
    if (mi < 0) st.textContent = '👀 Spectateur';
    else if (!playing) st.textContent = '🏁 Partie terminée';
    else if (mine) st.textContent = '🔥 À toi de jouer !';
    else st.textContent = '⏳ Tour de ' + S.pl[S.turn].name;
    op.className = ''; op.textContent = '';
    if (mi >= 0 && playing) {
      if (S.pl[mi].open) op.textContent = '🔓 Ouvert';
      else if (mine) {
        var f = R.freshInfo(orig.table, work.table);
        var okp = f.points >= R.OPEN_MIN && !f.untouchedMissing;
        op.textContent = '🔒 Ouverture : ' + f.points + '/' + R.OPEN_MIN + (f.untouchedMissing ? ' (ne touche pas à la table)' : '');
        op.className = okp ? 'ok' : 'bad';
      } else op.textContent = '🔒 Pas encore ouvert (30 pts)';
    }
    var changed = mine && work.rack.length !== orig.rack.length;
    be.disabled = !mine;
    be.classList.toggle('ready', false);
    if (!mine) be.textContent = playing ? 'Patiente…' : '—';
    else if (!changed) be.textContent = S.pool.length ? 'Piocher 🎴' : 'Passer ⏭';
    else {
      be.textContent = 'Terminer ✔';
      be.classList.toggle('ready', R.validateTurn(orig, work, S.pl[mi].open).ok);
    }
    $('#btnUndo').disabled = !mine || !history.length;
    $('#btnReset').disabled = !mine || !history.length;
    $('#btnSortN').disabled = $('#btnSortC').disabled = mi < 0;
  }

  /* ================= Actions du joueur ================= */
  function doDraw(auto) {
    if (!S || S.phase !== 'play') return;
    var mi = myIdx();
    if (mi < 0 || S.pl[S.turn].id !== myId) return;
    cancelDrag();
    if (auto) toast('⏱ Temps écoulé : tu pioches.');
    publish(R.draw(S, mi, false));
  }
  function onEnd() {
    if (!myTurn()) return;
    var mi = myIdx();
    if (work.rack.length === orig.rack.length) { doDraw(false); return; }
    var v = R.validateTurn(orig, work, S.pl[mi].open);
    if (!v.ok) {
      FX.sound('bad'); toast(v.msg); FX.vibrate(120);
      var b = $('#btnEnd'); b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
      return;
    }
    publish(R.commit(S, mi, orig, work, v));
  }
  function pushHist() {
    history.push(JSON.stringify({ t: work.table, r: work.rack }));
    if (history.length > 60) history.shift();
  }
  function undo() {
    if (!myTurn() || !history.length) return;
    var sn = JSON.parse(history.pop());
    setWork(sn.t, sn.r);
    FX.sound('pick'); render(); sendDraft();
  }
  function resetTurn() {
    if (!myTurn() || !history.length) return;
    setWork(R.clone(orig.table), orig.rack.slice());
    history = [];
    FX.sound('pick'); render(); sendDraft();
  }
  function sortRack(mode) {
    var ar = rackArr();
    var key = function (id) {
      var t = R.info(id);
      return t.joker ? [99, 0] : (mode === 'num' ? [t.n, t.c] : [t.c, t.n]);
    };
    ar.sort(function (a, b) { var x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || a - b; });
    FX.sound('pick'); renderRack();
  }
  function sendDraft() {
    if (!net || !myTurn() || draftTimer) return;
    draftTimer = setTimeout(function () {
      draftTimer = null;
      if (myTurn()) net.send({ t: 'draft', v: S.v, table: work.table });
    }, 250);
  }

  /* ================= Glisser-déposer ================= */
  function removeIds(ids) {
    var set = {};
    ids.forEach(function (id) { set[id] = 1; });
    var cut = function (arr) { for (var i = arr.length - 1; i >= 0; i--) if (set[arr[i]]) arr.splice(i, 1); };
    if (work) work.table.forEach(cut);
    cut(rackArr());
  }
  function insertBefore(arr, ids, anchor) {
    var i = anchor == null ? -1 : arr.indexOf(anchor);
    if (i < 0) Array.prototype.push.apply(arr, ids);
    else Array.prototype.splice.apply(arr, [i, 0].concat(ids));
  }
  function anchorIn(container, x, y, ids) {
    var tiles = container.querySelectorAll('.tile');
    for (var i = 0; i < tiles.length; i++) {
      var id = +tiles[i].dataset.id;
      if (ids.indexOf(id) >= 0) continue;
      var r = tiles[i].getBoundingClientRect();
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return id;
    }
    return null;
  }

  document.addEventListener('pointerdown', function (e) {
    if (drag || (e.button != null && e.button > 0)) return;
    if (!S || S.phase !== 'play' || myIdx() < 0) return;
    var game = e.target.closest && e.target.closest('#game');
    if (!game) return;
    var grip = e.target.closest('.grip'), tile = e.target.closest('.tile');
    var ids = null;
    if (grip) {
      if (!myTurn()) return;
      ids = work.table[+grip.parentElement.dataset.si].slice();
    } else if (tile) {
      if (!tile.closest('#rack') && !myTurn()) return;
      ids = [+tile.dataset.id];
    }
    if (!ids) return;
    drag = { ids: ids, x0: e.clientX, y0: e.clientY, on: false, pid: e.pointerId, touch: e.pointerType === 'touch', tgt: null, anchor: null };
    e.preventDefault();
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      startDrag();
    }
    drag.tx = e.clientX;
    drag.ty = e.clientY - (drag.touch ? 52 : 0);
    placeGhost();
    updateTarget();
  });
  window.addEventListener('pointerup', function (e) { if (drag && e.pointerId === drag.pid) endDrag(true); });
  window.addEventListener('pointercancel', function (e) { if (drag && e.pointerId === drag.pid) endDrag(false); });

  function startDrag() {
    drag.on = true;
    var g = el('div', 'ghost');
    drag.ids.forEach(function (id) { g.appendChild(tileEl(id)); });
    document.body.appendChild(g);
    var r = g.getBoundingClientRect();
    drag.ghost = g; drag.gw = r.width; drag.gh = r.height;
    drag.ids.forEach(function (id) {
      document.querySelectorAll('#game .tile[data-id="' + id + '"]').forEach(function (t) { t.classList.add('lifted'); });
    });
    document.body.classList.add('dragging');
    FX.sound('pick');
    requestAnimationFrame(autoScroll);
  }
  function placeGhost() {
    drag.ghost.style.transform = 'translate(' + (drag.tx - drag.gw / 2) + 'px,' + (drag.ty - drag.gh / 2) + 'px)';
  }
  function autoScroll() {
    if (!drag || !drag.on) return;
    var w = $('#tableWrap'), r = w.getBoundingClientRect();
    if (drag.tx > r.left && drag.tx < r.right) {
      if (drag.ty > r.top && drag.ty < r.top + 40) { w.scrollTop -= 10; updateTarget(); }
      else if (drag.ty < r.bottom && drag.ty > r.bottom - 40) { w.scrollTop += 10; updateTarget(); }
    }
    requestAnimationFrame(autoScroll);
  }
  function clearMarks() {
    document.querySelectorAll('#game .hot, #game .ins, #game .ins-end').forEach(function (e) { e.classList.remove('hot', 'ins', 'ins-end'); });
  }
  function updateTarget() {
    if (!drag || !drag.on) return;
    var x = drag.tx, y = drag.ty, tgt = null, cont = null, deny = false;
    var stack = document.elementsFromPoint(x, y);
    for (var i = 0; i < stack.length && !tgt; i++) {
      var e = stack[i];
      if (drag.ghost.contains(e)) continue;
      var set = e.closest('.set');
      if (set && myTurn()) { tgt = { kind: 'set', el: set, si: +set.dataset.si }; cont = set; break; }
      if (e.closest('#rackWrap')) { tgt = { kind: 'rack' }; cont = $('#rack'); break; }
      if (e.closest('#tableWrap') && myTurn()) { tgt = { kind: 'table' }; break; }
    }
    if (tgt && tgt.kind === 'rack' && myTurn()) {
      var o = {};
      orig.table.forEach(function (st) { st.forEach(function (id) { o[id] = 1; }); });
      if (drag.ids.some(function (id) { return o[id]; })) { deny = true; tgt = null; }
    }
    drag.deny = deny;
    drag.tgt = tgt;
    drag.anchor = cont ? anchorIn(cont, x, y, drag.ids) : null;
    clearMarks();
    if (!tgt) return;
    if (tgt.kind === 'table') { $('#tableWrap').classList.add('hot'); return; }
    if (tgt.kind === 'rack') $('#rackWrap').classList.add('hot'); else cont.classList.add('hot');
    if (drag.anchor != null) {
      var t = cont.querySelector('.tile[data-id="' + drag.anchor + '"]');
      if (t) t.classList.add('ins');
    } else cont.classList.add('ins-end');
  }
  function cancelDrag() { if (drag) endDrag(false); }
  function endDrag(drop) {
    var d = drag;
    drag = null;
    if (!d) return;
    clearMarks();
    document.body.classList.remove('dragging');
    if (d.ghost) d.ghost.remove();
    document.querySelectorAll('.tile.lifted').forEach(function (t) { t.classList.remove('lifted'); });
    if (!d.on || !drop) return;
    if (d.deny) { FX.sound('bad'); toast('Tu ne peux pas reprendre une tuile de la table.'); return; }
    if (!d.tgt) { FX.sound('bad'); return; }
    applyDrop(d.ids, d.tgt, d.anchor);
  }
  function applyDrop(ids, tgt, anchor) {
    if (myTurn()) pushHist();
    if (tgt.kind === 'rack') {
      var ar = rackArr();
      removeIds(ids);
      insertBefore(ar, ids, anchor);
    } else {
      var target = tgt.kind === 'set' ? work.table[tgt.si] : [];
      if (tgt.kind === 'table') work.table.push(target);
      removeIds(ids);
      insertBefore(target, ids, anchor);
      work.table = work.table.filter(function (s) { return s.length; });
    }
    FX.sound('drop');
    render();
    sendDraft();
  }

  /* ================= Chrono et absents ================= */
  setInterval(function () {
    if (!S || S.phase !== 'play') return;
    var cur = S.pl[S.turn];
    if (S.tl) {
      var left = S.tl - (Date.now() - turnStart) / 1000;
      var i = $('#chips .chip.turn .bar i');
      if (i) {
        i.style.width = Math.max(0, Math.min(100, left / S.tl * 100)) + '%';
        i.classList.toggle('low', left <= 10);
      }
      if (myTurn()) {
        if (left <= 10 && left > 0 && Math.ceil(left) !== lastTick) { lastTick = Math.ceil(left); FX.sound('tick'); }
        if (left <= 0) doDraw(true);
      }
    }
    // L'hôte fait piocher un joueur absent après quelques secondes.
    if (isHost() && cur && !roomPlayers.some(function (r) { return r.id === cur.id; })) {
      if (!absentSince) absentSince = Date.now();
      else if (Date.now() - absentSince > 12000) { absentSince = 0; publish(R.draw(S, S.turn, true)); }
    } else absentSince = 0;
  }, 250);

  /* ================= Mode de secours (hors hub) : salle locale entre onglets ================= */
  function localJoin(code) {
    var ch = new BroadcastChannel('rk-' + code), handlers = {}, peers = {};
    var keepKey = 'rk-keep-' + code;
    var self = { id: myId, name: myName, ts: Date.now() };
    peers[myId] = { id: myId, name: myName, ts: self.ts, seen: Date.now() };
    function emit(k) { var a = Array.prototype.slice.call(arguments, 1); (handlers[k] || []).forEach(function (f) { f.apply(null, a); }); }
    function list() {
      return Object.keys(peers).map(function (k) { return peers[k]; })
        .sort(function (a, b) { return a.ts - b.ts || (a.id < b.id ? -1 : 1); })
        .map(function (p) { return { id: p.id, name: p.name }; });
    }
    function hello() { ch.postMessage({ k: 'hello', p: self }); }
    ch.onmessage = function (ev) {
      var m = ev.data;
      if (m.k === 'hello') {
        var known = !!peers[m.p.id];
        peers[m.p.id] = { id: m.p.id, name: m.p.name, ts: m.p.ts, seen: Date.now() };
        if (!known) { emit('players', list()); hello(); }
      } else if (m.k === 'bye') { delete peers[m.id]; emit('players', list()); }
      else if (m.k === 'msg') emit('message', m.data, m.from);
    };
    var hb = setInterval(function () {
      hello();
      var now = Date.now(), changed = false;
      Object.keys(peers).forEach(function (k) { if (k !== myId && now - peers[k].seen > 6000) { delete peers[k]; changed = true; } });
      peers[myId].seen = now;
      if (changed) emit('players', list());
    }, 2000);
    setTimeout(function () {
      hello();
      var last = null;
      try { last = JSON.parse(localStorage.getItem(keepKey) || 'null'); } catch (e) {}
      emit('ready', { me: myId, players: list(), last: last });
    }, 80);
    return {
      on: function (k, f) { (handlers[k] = handlers[k] || []).push(f); },
      send: function (data, opt) {
        if (opt && opt.keep) { try { localStorage.setItem(keepKey, JSON.stringify(data)); } catch (e) {} }
        var from = { id: myId, name: myName };
        ch.postMessage({ k: 'msg', data: data, from: from });
        setTimeout(function () { emit('message', data, from); }, 0);
      },
      leave: function () { ch.postMessage({ k: 'bye', id: myId }); clearInterval(hb); ch.close(); }
    };
  }

  /* ================= Branchements ================= */
  $('#btnCreate').onclick = function () { join(randomCode(), true); };
  $('#btnJoin').onclick = function () { join($('#code').value, false); };
  $('#code').addEventListener('keydown', function (e) { if (e.key === 'Enter') join($('#code').value, false); });
  $('#btnRules').onclick = $('#mRules').onclick = function () { $('#rules').classList.remove('hidden'); $('#menu').classList.add('hidden'); };
  $('#btnRulesClose').onclick = function () { $('#rules').classList.add('hidden'); };
  $('#btnLeave').onclick = $('#mLeave').onclick = $('#btnQuit').onclick = leave;
  $('#btnStart').onclick = startGame;
  $('#btnAgain').onclick = startGame;
  $('#btnSee').onclick = function () { $('#over').classList.add('hidden'); };
  $('#btnEnd').onclick = onEnd;
  $('#btnUndo').onclick = undo;
  $('#btnReset').onclick = resetTurn;
  $('#btnSortN').onclick = function () { sortRack('num'); };
  $('#btnSortC').onclick = function () { sortRack('col'); };
  $('#roomCode').onclick = function () {
    var link = location.origin + location.pathname + '?room=' + roomCode;
    var done = function () { toast('Lien d’invitation copié !'); };
    try { navigator.clipboard.writeText(link).then(done, function () { toast('Code : ' + roomCode); }); } catch (e) { toast('Code : ' + roomCode); }
  };
  $('#btnMenu').onclick = function (e) { e.stopPropagation(); $('#menu').classList.toggle('hidden'); $('#logPanel').classList.add('hidden'); };
  $('#mSound').onclick = function () {
    var m = FX.toggleMute();
    $('#mSound').textContent = m ? '🔇 Son coupé' : '🔊 Son';
  };
  $('#mLog').onclick = function () {
    var p = $('#logPanel');
    p.textContent = '';
    (S ? S.log.slice().reverse() : []).forEach(function (l) { p.appendChild(el('div', null, l)); });
    p.classList.toggle('hidden');
    $('#menu').classList.add('hidden');
  };
  var rb = $('#reactBar');
  EMOJIS.forEach(function (e) {
    var b = el('button', null, e);
    b.onclick = function () {
      if (Date.now() - lastReact < 700 || !net) return;
      lastReact = Date.now();
      net.send({ t: 'react', e: e });
      rb.classList.add('hidden');
    };
    rb.appendChild(b);
  });
  $('#btnReact').onclick = function (e) { e.stopPropagation(); rb.classList.toggle('hidden'); };
  document.addEventListener('click', function () {
    $('#menu').classList.add('hidden'); rb.classList.add('hidden');
  });
  $('#logPanel').addEventListener('click', function (e) { e.stopPropagation(); });

  init();
})();
