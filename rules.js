/* Rummikub : règles et moteur d'état (pur, sans DOM).
 * Tuiles = entiers 0..105 : 0..103 = tuiles normales (2 séries x 4 couleurs x 13), 104 et 105 = jokers.
 * Un état de partie est un objet JSON simple, envoyé tel quel aux autres joueurs.
 */
(function (root) {
  'use strict';

  var HAND = 14;
  var OPEN_MIN = 30;

  function info(id) {
    if (id >= 104) return { id: id, joker: true, n: 0, c: -1 };
    return { id: id, joker: false, n: (id % 13) + 1, c: Math.floor(id / 26) };
  }

  function tileValue(id) { var t = info(id); return t.joker ? 30 : t.n; }
  function rackValue(rack) { return rack.reduce(function (a, id) { return a + tileValue(id); }, 0); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Analyse une combinaison (ordre = ordre posé sur la table).
   * Retourne { ok, type: 'run'|'group', value } ; value = points (joker = valeur représentée). */
  function analyse(ids) {
    var L = ids.length;
    if (L < 3) return { ok: false, why: 'short' };
    var ts = ids.map(info);
    var nj = ts.filter(function (t) { return !t.joker; });
    if (!nj.length) return { ok: false, why: 'jokers' };
    var best = null;

    // Brelan / carré : même chiffre, couleurs toutes différentes, 3 ou 4 tuiles
    if (L <= 4) {
      var num = nj[0].n;
      var same = nj.every(function (t) { return t.n === num; });
      var cols = {};
      var distinct = nj.every(function (t) { if (cols[t.c]) return false; cols[t.c] = 1; return true; });
      if (same && distinct) best = { ok: true, type: 'group', value: num * L };
    }

    // Suite : même couleur, chiffres qui se suivent, pas de passage 13 -> 1
    var col = nj[0].c;
    if (nj.every(function (t) { return t.c === col; })) {
      var i0 = 0;
      while (ts[i0].joker) i0++;
      var start = ts[i0].n - i0;
      if (start >= 1 && start + L - 1 <= 13 &&
          ts.every(function (t, i) { return t.joker || t.n === start + i; })) {
        var v = 0;
        for (var k = 0; k < L; k++) v += start + k;
        if (!best || v > best.value) best = { ok: true, type: 'run', value: v };
      }
    }
    return best || { ok: false, why: 'invalid' };
  }

  function sig(set) { return set.slice().sort(function (a, b) { return a - b; }).join(','); }

  /* Points des combinaisons NOUVELLES (non présentes à l'identique au début du tour). */
  function freshInfo(origTable, table) {
    var pool = origTable.map(sig);
    var fresh = [];
    table.forEach(function (s) {
      if (!s.length) return;
      var k = sig(s), i = pool.indexOf(k);
      if (i >= 0) pool.splice(i, 1); else fresh.push(s);
    });
    var pts = 0;
    fresh.forEach(function (s) { var a = analyse(s); if (a.ok) pts += a.value; });
    return { points: pts, untouchedMissing: pool.length, fresh: fresh };
  }

  function fail(msg) { return { ok: false, msg: msg }; }

  /* Vérifie le tour d'un joueur. orig/work = { table: [[ids]], rack: [ids] }. */
  function validateTurn(orig, work, opened) {
    var table = work.table.filter(function (s) { return s.length; });
    for (var i = 0; i < table.length; i++) {
      var a = analyse(table[i]);
      if (!a.ok) {
        return fail(table[i].length < 3
          ? 'Un groupe a moins de 3 tuiles.'
          : 'Une combinaison n’est ni une suite ni un brelan.');
      }
    }
    var flat = [].concat.apply([], table);
    var flatSet = {};
    for (var j = 0; j < flat.length; j++) {
      if (flatSet[flat[j]]) return fail('Tuile en double.');
      flatSet[flat[j]] = 1;
    }
    var origIds = [].concat.apply([], orig.table);
    var origSet = {};
    origIds.forEach(function (id) { origSet[id] = 1; });
    for (var k = 0; k < origIds.length; k++) {
      if (!flatSet[origIds[k]]) return fail('Une tuile de la table a disparu.');
    }
    var rackSet = {};
    orig.rack.forEach(function (id) { rackSet[id] = 1; });
    var placed = flat.filter(function (id) { return !origSet[id]; });
    if (!placed.length) return fail('Pose au moins une tuile de ton chevalet, ou pioche.');
    if (placed.some(function (id) { return !rackSet[id]; })) return fail('Tuile inconnue sur la table.');
    if (work.rack.length !== orig.rack.length - placed.length) return fail('Chevalet incohérent.');

    var points = 0;
    if (!opened) {
      var f = freshInfo(orig.table, table);
      if (f.untouchedMissing) return fail('Pour ouvrir, ne touche pas aux combinaisons de la table.');
      points = f.points;
      if (points < OPEN_MIN) return fail('Ouverture : il faut ' + OPEN_MIN + ' points (tu en as ' + points + ').');
    }
    return { ok: true, placed: placed, points: points, table: table };
  }

  /* ---------- Moteur d'état ---------- */

  function newGame(players, opts) {
    opts = opts || {};
    var deck = shuffle(Array.apply(null, Array(106)).map(function (_, i) { return i; }));
    var racks = players.map(function () { return deck.splice(0, HAND); });
    return {
      v: 1, gid: opts.gid, phase: 'play', tl: opts.tl || 0,
      pl: players.map(function (p) { return { id: p.id, name: p.name, open: false }; }),
      racks: racks, pool: deck, table: [], turn: 0, passes: 0,
      fr: [], log: ['La partie commence !'], ev: { k: 'start', by: 0 }, win: [], res: null
    };
  }

  function pushLog(s, line) {
    s.log.push(line);
    if (s.log.length > 14) s.log.shift();
  }

  function finish(s, winners, kind) {
    s.phase = 'over';
    s.win = winners;
    var left = s.racks.map(rackValue);
    var gain = 0;
    s.pl.forEach(function (_, i) { if (winners.indexOf(i) < 0) gain += left[i]; });
    s.res = s.pl.map(function (_, i) {
      var w = winners.indexOf(i) >= 0;
      return { i: i, left: left[i], delta: w ? Math.round(gain / winners.length) : -left[i] };
    });
    s.ev = { k: kind, by: winners[0] };
    return s;
  }

  function nextTurn(s) { s.turn = (s.turn + 1) % s.pl.length; }

  /* Le joueur idx pioche une tuile (ou passe si la pioche est vide). */
  function draw(s0, idx, forced) {
    var s = clone(s0);
    var name = s.pl[idx].name;
    s.v++;
    s.fr = [];
    if (s.pool.length) {
      s.racks[idx].push(s.pool.pop());
      s.passes = 0;
      pushLog(s, name + (forced ? ' est absent : il pioche.' : ' pioche une tuile.'));
      s.ev = { k: forced ? 'skip' : 'draw', by: idx };
    } else {
      s.passes++;
      pushLog(s, name + ' passe (pioche vide).');
      s.ev = { k: 'pass', by: idx };
      if (s.passes >= s.pl.length) {
        var vals = s.racks.map(rackValue);
        var min = Math.min.apply(null, vals);
        var w = [];
        vals.forEach(function (v, i) { if (v === min) w.push(i); });
        pushLog(s, 'Partie bloquée : le plus petit chevalet gagne.');
        return finish(s, w, 'block');
      }
    }
    nextTurn(s);
    return s;
  }

  /* Valide le tour (déjà vérifié par validateTurn -> v) et passe la main. */
  function commit(s0, idx, orig, work, v) {
    var s = clone(s0);
    var name = s.pl[idx].name;
    var wasOpen = s.pl[idx].open;
    var n = v.placed.length;
    // détection de manipulation / jokers pour les effets
    var origSigs = orig.table.map(sig);
    var newSigs = v.table.map(sig);
    var manip = origSigs.some(function (k) { return newSigs.indexOf(k) < 0; });
    var jokerPlaced = v.placed.some(function (id) { return id >= 104; });
    var jokerMoved = false;
    orig.table.forEach(function (set) {
      set.forEach(function (id) {
        if (id < 104) return;
        var now = v.table.filter(function (t) { return t.indexOf(id) >= 0; })[0];
        if (now && sig(now) !== sig(set)) jokerMoved = true;
      });
    });
    s.v++;
    s.table = v.table;
    s.racks[idx] = work.rack.slice();
    s.pl[idx].open = true;
    s.fr = v.placed;
    s.passes = 0;
    var line = name + ' pose ' + n + ' tuile' + (n > 1 ? 's' : '');
    if (!wasOpen) line += ' et ouvre (' + v.points + ' pts)';
    else if (manip) line += ' en manipulant la table';
    if (jokerMoved) line += ' (joker récupéré !)';
    pushLog(s, line + '.');
    var ev = { k: 'play', by: idx, n: n, open: !wasOpen, pts: v.points, manip: manip && wasOpen,
               jp: jokerPlaced, jm: jokerMoved, left: s.racks[idx].length };
    s.ev = ev;
    if (!s.racks[idx].length) {
      pushLog(s, name + ' a posé sa dernière tuile !');
      finish(s, [idx], 'win');
      ev.k = 'win';
      s.ev = ev;
      return s;
    }
    nextTurn(s);
    return s;
  }

  var api = {
    HAND: HAND, OPEN_MIN: OPEN_MIN, info: info, tileValue: tileValue, rackValue: rackValue,
    analyse: analyse, freshInfo: freshInfo, validateTurn: validateTurn, newGame: newGame,
    draw: draw, commit: commit, clone: clone, sig: sig
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rules = api;
})(typeof window !== 'undefined' ? window : this);
