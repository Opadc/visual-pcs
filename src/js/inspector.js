/* Click a block in the 3D scene to see what it carries. The block is outlined,
   the animation pauses, and a card next to it shows ASCII and hex (or 10-bit
   symbols inside the FEC zone). The card follows the block if you resume. */
(function (P) {
  'use strict';
  var T = window.THREE, G = P.g, S = P.state;
  var ray = new T.Raycaster(), ndc = new T.Vector2(), v = new T.Vector3();
  var card, outline, picked = null, lastSig = '', symSel = -1;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function q(ch) { return ch === 32 ? 'space' : '‘' + esc(String.fromCharCode(ch)) + '’'; }

  P.initInspector = function (host) {
    card = document.createElement('div');
    card.className = 'inspector';
    card.id = 'inspector';
    card.hidden = true;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Block contents');
    host.appendChild(card);

    outline = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1)),
      new T.LineBasicMaterial({ color: G.col.ink, depthTest: false, transparent: true }));
    outline.renderOrder = 10;
    outline.visible = false;
    G.scene.add(outline);

    var el = G.renderer.domElement, down = null;
    el.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, b: e.button }; });
    el.addEventListener('pointerup', function (e) {
      if (!down || down.b !== 0) return;
      var moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5) return;
      var r = el.getBoundingClientRect();
      pickAt(e.clientX - r.left, e.clientY - r.top);
    });
    el.addEventListener('pointermove', function (e) {
      if (down) return;
      var r = el.getBoundingClientRect();
      el.style.cursor = nearest(e.clientX - r.left, e.clientY - r.top, 12) >= 0 ? 'pointer' : '';
    });

    card.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act;
      if (act === 'close') P.closeInspector(true);
      else if (act === 'resume') P.setPlaying(true);
      else if (act === 'sym') { symSel = +b.dataset.i; lastSig = ''; }
      else if (act === 'word') { P.followWord(+b.dataset.i); lastSig = ''; }
      else if (act === 'unfollow') { P.followWord(null); lastSig = ''; }
      else if (act === 'prev' || act === 'next') stepBlock(act === 'next' ? 1 : -1);
    });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); P.closeInspector(true); }
    });
  };

  // Screen-space nearest block centre; used when the ray misses a small cube.
  function nearest(sx, sy, radius) {
    var best = -1, bd = radius * radius, n = P.packetCount();
    for (var i = 0; i < n; i++) {
      var b = P.packetBox(i);
      v.set(b[0], b[1], b[2]).project(G.camera);
      if (v.z > 1) continue;
      var px = (v.x + 1) / 2 * G.w, py = (1 - v.y) / 2 * G.h, d = (px - sx) * (px - sx) + (py - sy) * (py - sy);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function pickAt(sx, sy) {
    ndc.set(sx / G.w * 2 - 1, -(sy / G.h) * 2 + 1);
    ray.setFromCamera(ndc, G.camera);
    var hit = ray.intersectObject(G.inst, false)[0];
    var i = hit && hit.instanceId != null && hit.instanceId < P.packetCount() ? hit.instanceId : nearest(sx, sy, 16);
    if (i < 0) { P.closeInspector(); return; }
    open(P.packetMeta(i));
  }

  // Keyboard: inspect the block nearest the centre of the view.
  P.inspectCenter = function () {
    var i = nearest(G.w / 2, G.h / 2, Math.max(G.w, G.h));
    if (i >= 0) open(P.packetMeta(i), true);
  };

  function open(m, focus) {
    picked = { key: P.packetKey(m), meta: m };
    symSel = -1; lastSig = '';
    if (S.playing) P.setPlaying(false);
    card.hidden = false;
    P.updateInspector();
    if (focus) { var b = card.querySelector('[data-act="close"]'); if (b) b.focus(); }
  }

  P.closeInspector = function (restoreFocus) {
    picked = null;
    card.hidden = true;
    outline.visible = false;
    if (restoreFocus) document.getElementById('viewport').focus();
  };
  P.inspectorOpen = function () { return !!picked; };

  // Previous / next block in the same family: along the lane, or along the stream.
  // Higher indices are further back in the stream, so "next" means sent later.
  function stepKey(m, dir) {
    if (m.fam === 'lane') return 'lane:' + m.p + ':' + (m.n + dir);
    if (m.fam === 'b66') return 'b66:' + (m.t + dir);
    if (m.fam === 'b257') return 'b257:' + (m.s + dir);
    if (m.fam === 'row') {
      var c = m.c + dir, q = m.q;
      if (c < 0) { c = P.ROW_CUBES.length - 1; q--; } else if (c >= P.ROW_CUBES.length) { c = 0; q++; }
      return 'row:' + q + ':' + m.w + ':' + c;
    }
    return null;
  }
  function stepBlock(dir) {
    if (!picked) return;
    var key = stepKey(picked.meta, dir), i = key ? P.findPacket(key) : -1;
    if (i >= 0) { picked = { key: key, meta: P.packetMeta(i) }; symSel = -1; lastSig = ''; P.updateInspector(); }
  }

  // Called every frame after drawPackets. When a block leaves its stage, the
  // card follows it into the next form: 66-bit slot t sits in 257-bit slot t/4.
  function handoff(m) {
    if (m.fam === 'b66') return 'b257:' + Math.floor(m.t / 4);
    if (m.fam === 'b257') return 'b66:' + 4 * m.s;
    return null;
  }

  P.updateInspector = function () {
    if (!picked) return;
    var i = P.findPacket(picked.key);
    if (i < 0) {
      var alt = handoff(picked.meta), j = alt ? P.findPacket(alt) : -1;
      if (j >= 0) { picked = { key: alt, meta: P.packetMeta(j) }; i = j; symSel = -1; }
    }
    if (i < 0) {
      outline.visible = false;
      if (lastSig !== 'gone') {
        lastSig = 'gone';
        var body = card.querySelector('.ins-body');
        if (body) body.innerHTML = '<p class="ins-note">This block has left this part of the scene' +
          (picked.meta.fam === 'lane' ? '. After lane reorder its symbol goes back into its codeword for RS decode' : '') +
          '. Click another block to keep exploring.</p>';
      }
      return;
    }
    var m = P.packetMeta(i), b = P.packetBox(i);
    picked.meta = m;
    outline.visible = true;
    outline.position.set(b[0], b[1], b[2]);
    outline.scale.set(b[3] + 0.14, b[4] + 0.14, b[5] + 0.14);
    outline.material.color.copy(G.col.ink);

    var d = P.describePacket(m);
    var fwk = P.followed && P.followed();
    var sig = (fwk ? fwk.s : '') + '|' + P.payloadVersion + '|' + d.kind + '|' + d.title + '|' + d.where + '|' + d.state + '|' + S.playing + '|' + symSel + '|' + (d.lane ? d.lane.rxPma + ':' + d.lane.serdes : '');
    if (sig !== lastSig) { lastSig = sig; card.innerHTML = render(d); }
    place(b);
  };

  function place(b) {
    var vp = G.host, W = vp.clientWidth, H = vp.clientHeight;
    if (W < 620) { card.classList.add('docked'); card.style.transform = ''; return; }
    card.classList.remove('docked');
    v.set(b[0], b[1], b[2]).project(G.camera);
    var sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
    var cw = card.offsetWidth, ch = card.offsetHeight, gap = 18;
    var x = sx + gap + cw < W - 8 ? sx + gap : sx - gap - cw;
    x = Math.max(8, Math.min(x, W - cw - 8));
    var y = Math.max(8, Math.min(sy - ch / 2, H - ch - 8));
    card.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }

  // One character cell. Word characters are buttons: clicking follows that word.
  function cell(idx, cls, partial) {
    var c = P.byteAt(idx), w = P.wordAround(idx), fw = P.followed && P.followed();
    var on = fw && P.inWord(idx, fw) ? ' fw' : '', k = (cls || '') + (c === 32 ? ' sp' : '') + on + (partial ? ' part' : '');
    var inner = '<b>' + (c === 32 ? '&nbsp;' : esc(P.glyph(c))) + '</b><i>' + (partial ? partial + '/8' : P.hex(c, 2)) + '</i>';
    return w ? '<button type="button" class="cell ' + k + '" data-act="word" data-i="' + idx + '" title="Follow \u201C' + esc(w.text) + '\u201D">' + inner + '</button>'
      : '<span class="cell ' + k + '">' + inner + '</span>';
  }
  function cells(start, len, cls) {
    var h = '';
    for (var i = 0; i < len; i++) h += cell(start + i, cls);
    return h;
  }
  // Running text with word characters clickable; the followed word is marked.
  function text(start, len) {
    var h = '', fw = P.followed && P.followed();
    for (var i = start; i < start + len; i++) {
      var c = P.byteAt(i), g = c === 32 ? '<span class="gap"> </span>' : esc(P.glyph(c));
      h += P.wordAround(i) ? '<span class="wc' + (fw && P.inWord(i, fw) ? ' fw' : '') + '" data-act="word" data-i="' + i + '">' + g + '</span>' : g;
    }
    return h;
  }

  // One lane cube = 4 consecutive PCS-lane symbols. Symbol distribution deals
  // them from alternating codewords, 4 positions apart, so they are not
  // neighbours in the text.
  function laneSymbols(d) {
    var h = '<div class="lsyms">';
    d.symbols.forEach(function (s, n) {
      var cls = s.parity ? ' par' : s.parts.some(function (pt) { return pt.kind === 'am'; }) ? ' am' : '';
      h += '<button type="button" class="lsym ' + (s.w ? 'b' : 'a') + cls + (n === symSel ? ' on' : '') + '" data-act="sym" data-i="' + n + '">' +
        '<b>' + (s.w ? 'B' : 'A') + s.i + '</b><i>' + (s.parity ? 'parity' : s.hex) + '</i></button>';
    });
    h += '</div>';
    if (symSel >= 0) h += symbolLine(d.symbols[symSel]);
    else if (d.am) h += '<p class="ins-note">These symbols are lane ' + d.lane.pcs + '’s alignment marker. The AM group was pre-interleaved ' +
      'so that symbol distribution hands every lane its own 120-bit marker as its first 12 symbols.</p>';
    else h += '<p class="ins-note">Lane symbol k comes from codeword ' + (d.lane.pcs & 1 ? 'B' : 'A') + ' when k is even and ' + (d.lane.pcs & 1 ? 'A' : 'B') +
      ' when it is odd, at codeword position 4k + ' + (d.lane.pcs >> 1) + '. Click a symbol to see its bits.</p>';
    return h;
  }

  function symbolLine(s) {
    if (s.parity) return '<p class="ins-note">' + (s.w ? 'B' : 'A') + s.i + ' is parity symbol ' + (s.p + 1) + ' of 30. The RS(544,514) encoder computes it from the 514 message symbols. It carries no text.</p>';
    var bits = '', legend = [];
    s.parts.forEach(function (pt, k) {
      bits += '<span class="sb c' + (k % 3) + '">' + pt.bits + '</span>';
      var what = pt.kind === 'hdr' ? 'the header bit of 257-bit block ' + pt.block
        : pt.kind === 'am' ? pt.n + ' bit' + (pt.n > 1 ? 's' : '') + ' of am_' + pt.lane + ' ' + pt.field
        : pt.kind === 'pad' ? pt.n + ' bits of the AM pad' : pt.kind === 'sf' ? 'the AM status field'
        : (pt.n === 8 ? 'all 8 bits' : pt.n + ' bit' + (pt.n > 1 ? 's' : '')) + ' of ' + q(pt.ch);
      legend.push('<span class="c' + (k % 3) + '">' + what + '</span>');
    });
    // A few characters either side, so repeated letters can be told apart.
    var idx = s.parts.filter(function (pt) { return pt.kind === 'byte'; }).map(function (pt) { return pt.idx; });
    var ctx = '';
    if (idx.length) {
      var lo = idx[0] - 6, hi = idx[idx.length - 1] + 6;
      for (var i = lo; i <= hi; i++) {
        var k = idx.indexOf(i), g = esc(P.glyph(P.byteAt(i)));
        ctx += k >= 0 ? '<mark class="c' + (s.parts.findIndex(function (pt) { return pt.idx === i && pt.kind === 'byte'; }) % 3) + '">' + g + '</mark>' : g;
      }
      ctx = '<p class="ins-ctx">In the text: <code>…' + ctx + '…</code></p>';
    }
    return '<div class="ins-sym"><span class="symhex">' + (s.w ? 'B' : 'A') + s.i + ' = ' + s.hex + '</span><span class="symbin" title="bit 0 first">' + bits + '</span></div>' +
      '<p class="ins-src">' + legend.join(' + ') + '</p>' + ctx;
  }

  // The 1028-bit AM group: 96 interleaved 10-bit symbols, the pad and status.
  function amGroup() {
    var h = '<div class="amgrid">';
    for (var t = 0; t < 96; t++) {
      var k = t >> 3, r = t & 7, j = r >> 1, x = (k % 2 === 0) === ((r & 1) === 0) ? 2 * j : 2 * j + 1;
      h += '<span class="ams l' + x + '" title="symbol ' + t + ': am_' + x + ' bits ' + (10 * k) + '–' + (10 * k + 9) + '">' + x + '</span>';
    }
    h += '</div><p class="ins-note">1028 bits = 8 markers × 120 + 65-bit pad + 3-bit status, the size of four 257-bit blocks. ' +
      'Each cell is 10 bits of one lane’s marker, numbered by lane. The order looks scrambled on purpose: after pre-FEC distribution ' +
      'and symbol distribution, every PCS lane receives exactly its own 120-bit marker.</p>' +
      '<p class="ins-note">Inserted after the scrambler, once every 81,920 257-bit blocks (2,048 codeword pairs). The lab inserts one every pair so you can watch it.</p>';
    return h;
  }

  function render(d) {
    var h = '<header class="ins-head"><div><span class="ins-side">' + d.side + ' · ' + esc(d.where) + '</span>' +
      '<h4>' + esc(d.title) + '</h4></div><button type="button" class="ins-x" data-act="close" aria-label="Close">×</button></header><div class="ins-body">';

    if (d.state === 'lf') h += '<p class="ins-warn">No data. The RX PCS is not aligned, so it sends Local Fault to the MAC.</p>';
    if (d.state === 'unc') h += '<p class="ins-warn">This block came from an uncorrectable codeword. The PCS marks it as an error, and the MAC will see a bad frame.</p>';
    if (d.state === 'err') h += '<p class="ins-warn">Channel noise flipped bits in this symbol. RS decode can repair up to 15 bad symbols per codeword.</p>';
    if (d.state === 'los') h += '<p class="ins-warn">This SerDes lane has lost signal. The receiver gets no valid bits for any PCS lane it carries.</p>';
    if (d.state === 'ambad') h += '<p class="ins-warn">This marker arrives corrupted. Enough bad markers in a row and lane ' + d.lane.pcs + ' loses lock.</p>';

    if (d.kind === 'mii' || d.kind === 'b66') {
      h += '<p class="ins-ascii">' + text(d.start, 8) + '</p><div class="cells">' +
        (d.kind === 'b66' ? '<span class="cell hdr"><b>01</b><i>sync</i></span>' : '') + cells(d.start, 8) + '</div>';
      h += '<p class="ins-note">' + (d.kind === 'mii'
        ? '8 data bytes per transfer. Control characters (preamble, idles, terminate) are left out of this model.'
        : 'Same 8 bytes plus a 2-bit sync header. 01 means the block is all data.') + '</p>';
    } else if (d.kind === 'idle') {
      h += '<p class="ins-note">Idle characters between frames. Rate matching deletes enough of them to leave room for the 1028-bit AM group, ' +
        'so the data rate does not change when markers are added.</p>';
    } else if (d.kind === 'b257') {
      h += '<p class="ins-ascii">' + text(d.start, 32) + '</p><div class="cells wrap"><span class="cell hdr"><b>1</b><i>hdr</i></span>' +
        [0, 1, 2, 3].map(function (g) { return '<span class="grp">' + cells(d.start + g * 8, 8, d.scrambled ? 'scr' : '') + '</span>'; }).join('') + '</div>';
      h += '<p class="ins-note">Four 66-bit blocks (' + d.from66[0] + '–' + d.from66[1] + ') packed into one: their four 2-bit headers become a single 1. ' +
        'Slot ' + (d.slot + 1) + ' of 40 in codeword pair ' + d.pair + '. ' +
        (d.scrambled ? 'This block is <b>scrambled</b>. On the wire the bits look random; the text is shown unscrambled so you can follow it.' : '') + '</p>';
    } else if (d.kind === 'amgroup') {
      h += amGroup();
    } else if (d.kind === 'cw') {
      var data = d.symbols.length - d.parityCount;
      h += '<p class="ins-note">' + (d.parityCount
        ? 'The 30 parity symbols the RS(544,514) encoder appends to codeword ' + (d.w ? 'B' : 'A') + '. Message symbols 0–513 plus these = 544.'
        : data + ' message symbols. Pre-FEC distribution dealt the stream 10 bits at a time: A gets bits 20i…20i+9, B gets 20i+10…20i+19.' +
          (d.amCount ? ' The first ' + d.amCount + ' symbols here hold the AM group.' : '')) + '</p>';
      h += '<div class="syms">' + d.symbols.map(function (s, i) {
        var am = !s.parity && s.parts.some(function (pt) { return pt.kind === 'am' || pt.kind === 'pad' || pt.kind === 'sf'; });
        return '<button type="button" class="sym' + (s.parity ? ' par' : am ? ' am' : '') + (i === symSel ? ' on' : '') + '" data-act="sym" data-i="' + i + '" title="' + (d.w ? 'B' : 'A') + s.i + '">' +
          (s.parity ? 'P' : s.hex) + '</button>';
      }).join('') + '</div>';
      if (symSel >= 0) h += symbolLine(d.symbols[symSel]);
      else if (d.sources.length) h += '<p class="ins-src">Holds bits of: <span class="ins-ascii sm">' + text(d.sources[0], d.sources[d.sources.length - 1] - d.sources[0] + 1) + '</span> Click a symbol to see which bits.</p>';
    } else if (d.kind === 'lane') {
      h += laneSymbols(d);
    }

    var fw = P.followed && P.followed();
    if (fw) {
      var part = d.cover ? P.wordPart(d.cover, fw) : '';
      h += '<p class="ins-follow">Following <b>\u201C' + esc(fw.text) + '\u201D</b>' + (part ? ': this block holds <b>' + esc(part) + '</b>' : ': not in this block') +
        ' <button type="button" class="linkbtn" data-act="unfollow">Stop</button></p>';
    } else if (d.cover && d.cover.length) {
      h += '<p class="ins-hint">Click a word to light up every block that carries it.</p>';
    }
    if (d.lane) {
      var L = d.lane;
      h += '<p class="ins-path"><span class="sw l' + L.pcs + '"></span>PCS ' + L.pcs + ' → SerDes ' + L.serdes +
        (L.k > 1 ? ' (bit slot ' + (L.slot + 1) + ' of ' + L.k + ')' : '') + ' → RX PMA ' + L.rxPma + ' → reordered to PCS ' + L.pcs + '</p>';
    }
    h += '</div><footer class="ins-foot"><button type="button" class="btn" data-act="prev" title="Block before this one">← Prev</button>' +
      '<button type="button" class="btn" data-act="next" title="Block after this one">Next →</button>' +
      (S.playing ? '' : '<button type="button" class="btn" data-act="resume">Resume and follow</button>') + '</footer>';
    return h;
  }
})(globalThis.PCS = globalThis.PCS || {});
