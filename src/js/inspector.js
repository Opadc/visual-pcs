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
  function stepBlock(dir) {
    if (!picked) return;
    // Higher n is further back in the stream, so "next" means sent later.
    var m = picked.meta, key = m.fam === 'lane' ? 'lane:' + m.p + ':' + (m.n + dir)
      : m.fam + ':' + (m.row == null ? '' : m.row) + ':' + (m.n + dir);
    var i = P.findPacket(key);
    if (i >= 0) { picked = { key: key, meta: P.packetMeta(i) }; symSel = -1; lastSig = ''; P.updateInspector(); }
  }

  // Called every frame after drawPackets.
  // 66-bit block 4m sits where 257-bit block m is, so the card can follow a
  // block through the transcode in either direction.
  function handoff(m) {
    if (m.fam === 'g66') return 'g257::' + Math.floor(m.n / 4);
    if (m.fam === 'g257') return 'g66::' + 4 * m.n;
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
    var sig = P.payloadVersion + '|' + d.title + '|' + d.where + '|' + d.state + '|' + S.playing + '|' + symSel + '|' + (d.lane ? d.lane.rxPma + ':' + d.lane.serdes : '');
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

  function cells(bytes, cls) {
    return bytes.map(function (c) {
      return '<span class="cell ' + (cls || '') + (c === 32 ? ' sp' : '') + '"><b>' + esc(P.glyph(c)) + '</b><i>' + P.hex(c, 2) + '</i></span>';
    }).join('');
  }

  function symbolLine(s) {
    if (s.parity) return '<p class="ins-note">RS parity symbol ' + s.j + ' of codeword ' + (s.w ? 'B' : 'A') +
      '. The encoder computes the 30 parity symbols from the 514 data symbols. They carry no text.</p>';
    var bits = '', legend = [];
    s.parts.forEach(function (pt, k) {
      bits += '<span class="sb c' + (k % 3) + '">' + pt.bits + '</span>';
      legend.push(pt.kind === 'hdr'
        ? '<span class="c' + (k % 3) + '">header bit of 257-bit block ' + pt.block + '</span>'
        : '<span class="c' + (k % 3) + '">' + (pt.whole ? 'all 8 bits' : pt.n + ' bit' + (pt.n > 1 ? 's' : '') + ' (' + (pt.n > 1 ? pt.hi + '–' + pt.lo : pt.hi) + ')') +
          ' of ' + q(pt.ch) + '</span>');
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
    return '<div class="ins-sym"><span class="symhex">' + s.hex + '</span><span class="symbin">' + bits + '</span></div>' +
      '<p class="ins-src">' + legend.join(' + ') + '</p>' + ctx;
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
      h += '<p class="ins-ascii">' + esc(d.ascii.replace(/ /g, '·')) + '</p><div class="cells">' +
        (d.kind === 'b66' ? '<span class="cell hdr"><b>01</b><i>sync</i></span>' : '') + cells(d.bytes) + '</div>';
      h += '<p class="ins-note">' + (d.kind === 'mii'
        ? '8 data bytes per transfer. Control characters (preamble, idles, terminate) are left out of this model.'
        : 'Same 8 bytes plus a 2-bit sync header. 01 means the block is all data.') + '</p>';
    } else if (d.kind === 'b257') {
      h += '<p class="ins-ascii">' + esc(d.ascii.replace(/ /g, '·')) + '</p><div class="cells wrap"><span class="cell hdr"><b>1</b><i>hdr</i></span>' +
        [0, 1, 2, 3].map(function (g) { return '<span class="grp">' + cells(d.bytes.slice(g * 8, g * 8 + 8), d.scrambled ? 'scr' : '') + '</span>'; }).join('') + '</div>';
      h += '<p class="ins-note">Four 66-bit blocks (' + d.from66[0] + '–' + d.from66[1] + ') packed into one: their four 2-bit headers become a single 1. ' +
        (d.scrambled ? 'This block is <b>scrambled</b>. On the wire the bits look random; the text is shown unscrambled so you can follow it.' : '') + '</p>';
    } else if (d.kind === 'amgroup') {
      h += '<p class="ins-note">Eight alignment markers, one for each PCS lane, inserted together after the scrambler. Each is 120 bits: common bytes for finding it, unique bytes naming the lane. They are not part of the text.</p>';
    } else if (d.kind === 'cw') {
      h += '<p class="ins-note">10-bit RS symbols. Characters are 8 bits, so symbol edges no longer line up with them. The text is unreadable here until post-FEC interleave on the RX side.</p>';
      h += '<div class="syms">' + d.symbols.map(function (s, i) {
        return '<button type="button" class="sym' + (s.parity ? ' par' : '') + (i === symSel ? ' on' : '') + '" data-act="sym" data-i="' + i + '">' +
          (s.parity ? 'P' : s.hex) + '</button>';
      }).join('') + '</div>';
      if (symSel >= 0) h += symbolLine(d.symbols[symSel]);
      else if (d.sources.length) h += '<p class="ins-src">Holds bits of: <code>' + esc(d.sources.map(function (s) { return P.glyph(s.ch); }).join('')) + '</code>. Click a symbol to see which.</p>';
      if (d.parityCount) h += '<p class="ins-note">P = parity symbols added by the RS(544,514) encoder.</p>';
    } else if (d.kind === 'sym') {
      h += symbolLine(d.symbol);
      if (!d.symbol.parity) h += '<p class="ins-note">Symbol ' + d.symbol.j + ' of codeword ' + (d.symbol.w ? 'B' : 'A') + ' (pair ' + d.symbol.cw + '). ' +
        'A PCS lane carries 10-bit symbols, not characters.</p>';
    } else if (d.kind === 'am') {
      h += '<p class="ins-note">The alignment marker for PCS lane ' + d.lane.pcs + '. The receiver finds it by its common bytes and reads the lane number from its unique bytes. That is how lane identity survives the trip.</p>';
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
