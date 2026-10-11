/* Bit lens: a slow-motion 2D view of one PCS operation at true bit scale,
   drawn from the same payload model as the scene and the inspector. It shows
   codeword pair LENS_Q (an AM pair), and a cursor sweeps it one step at a time
   with the main Play/Pause/Step controls.

   Modes:
     am     AM insertion: idles leave a 4-slot gap; the 1028-bit group drops in
     prefec pre-FEC distribution: 10-bit tiles dealt alternately to m_A and m_B
     rs     RS(544,514): 514 message symbols, then 30 parity symbols appended
     dist   symbol distribution: tx_out order onto 8 PCS lanes
     mux    PMA bit-mux: PCS lane bits interleaved onto SerDes lanes */
(function (P) {
  'use strict';
  var S = P.state, cv, ctx, dpr = 1, mode = null, step = 0, acc = 0;
  var LENS_Q = 0;
  var MODES = {
    am: { title: 'AM insertion', stage: 3, steps: 40, rate: 4 },
    prefec: { title: 'Pre-FEC distribution', stage: 3, steps: 32, rate: 5 },
    rs: { title: 'RS(544,514) encode', stage: 3, steps: 544, rate: 60 },
    dist: { title: 'Symbol distribution', stage: 4, steps: 128, rate: 10 },
    mux: { title: 'PMA bit-mux', stage: 5, steps: 80, rate: 10 }
  };
  P.LENS_MODES = MODES;

  P.initLens = function () {
    var host = document.getElementById('lens');
    if (!host) return;
    cv = document.getElementById('lens-canvas');
    ctx = cv.getContext('2d');
    host.querySelectorAll('[data-lens]').forEach(function (b) {
      b.addEventListener('click', function () { P.setLens(b.dataset.lens === mode ? null : b.dataset.lens); });
    });
    document.getElementById('lens-close').onclick = function () { P.setLens(null); };
    new ResizeObserver(size).observe(cv.parentElement);
    P.on(function (what) { if (what === 'link' || what === 'payload') size(); });
  };

  P.setLens = function (m) {
    mode = MODES[m] ? m : null;
    step = 0; acc = 0;
    var host = document.getElementById('lens');
    host.classList.toggle('open', !!mode);
    host.querySelectorAll('[data-lens]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lens === mode)); });
    document.getElementById('lens-body').hidden = !mode;
    if (mode) { size(); P.lensNote(); }
  };
  P.lensMode = function () { return mode; };

  // Advance with the animation clock; Step advances one step.
  P.lensTick = function (dt) {
    if (!mode) return;
    if (S.playing) {
      acc += dt * MODES[mode].rate * S.speed;
      var n = Math.floor(acc); acc -= n;
      if (n) { step = (step + n) % (MODES[mode].steps + 12); P.lensNote(); }
    }
    draw();
  };
  P.lensStep = function () {
    if (!mode) return false;
    step = (step + 1) % (MODES[mode].steps + 12);
    P.lensNote(); draw();
    return true;
  };

  function size() {
    if (!cv || !mode) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Narrow screens scroll the lens sideways rather than squeezing 10-bit tiles.
    var w = Math.max(620, cv.parentElement.clientWidth);
    var h = mode === 'dist' ? 300 : mode === 'mux' ? 152 + 22 * S.link.k : mode === 'rs' ? 230 : 250;
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    draw();
  }

  // ---- drawing helpers ----
  var th;
  function font(sz, wt) { return (wt || 500) + ' ' + sz + 'px "IBM Plex Mono", ui-monospace, monospace'; }
  function box(x, y, w, h, fill, stroke) {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
  }
  function label(s, x, y, col, sz, align, wt) {
    ctx.fillStyle = col || th.ink; ctx.font = font(sz || 11, wt); ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }
  function mix(a, b, t) {
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
    var g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
    var bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  function hexColor(c) {
    if (c[0] === '#' && c.length === 7) return c;
    var el = document.createElement('div'); el.style.color = c; document.body.appendChild(el);
    var m = getComputedStyle(el).color.match(/\d+/g); el.remove();
    return '#' + ((1 << 24) | (m[0] << 16) | (m[1] << 8) | +m[2]).toString(16).slice(1);
  }
  function theme() {
    var t = P.g.theme || P.readTheme();
    th = { ink: hexColor(t.ink), muted: hexColor(t.muted), paper: hexColor(P.css('--panel')), rule: hexColor(t.rule),
      am: hexColor(t.am), a: hexColor(t.cwA), b: hexColor(t.cwB), bad: hexColor(t.bad), edge: hexColor(t.edge),
      lanes: t.lanes.map(hexColor) };
  }
  P.lensRecolor = function () { th = null; draw(); };

  // Stream bit b of LENS_Q coloured by what it is: AM (by lane), pad, header, or data.
  function bitColor(b) {
    var s = P.pairBit(LENS_Q, b);
    if (s.src === 'am') return th.lanes[s.lane];
    if (s.src === 'pad' || s.src === 'sf') return th.am;
    if (s.src === 'h') return th.ink;
    return th.edge;
  }

  function draw() {
    if (!ctx || !mode) return;
    if (!th) theme();
    var W = cv.width / dpr, H = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ({ am: drawAm, prefec: drawPrefec, rs: drawRs, dist: drawDist, mux: drawMux })[mode](W, H);
  }

  // AM insertion: 40 slots of one codeword pair. Before: 4 idle slots then 36
  // blocks. The group falls into the gap as the cursor reaches it.
  function drawAm(W, H) {
    var x0 = 70, sw = (W - x0 - 16) / 40, y1 = 52, y2 = 150, hh = 34, k = Math.min(step, 40);
    label('before', 8, y1 + hh / 2, th.muted, 11);
    label('after', 8, y2 + hh / 2, th.muted, 11);
    for (var s = 0; s < 40; s++) {
      var x = x0 + s * sw, sl = P.slot257(LENS_Q * 40 + s);
      if (sl.am) box(x + 1, y1, sw - 2, hh, null, th.rule);
      else { box(x + 1, y1, sw - 2, hh, th.edge); if (sw > 18) label(String(sl.block), x + sw / 2, y1 + hh / 2, th.paper, 9, 'center'); }
      if (s < k || !sl.am) {
        if (sl.am) {
          if (s === 0) {
            var fall = Math.min(1, k / 4), gy = y1 + (y2 - y1) * fall;
            for (var n = 0; n < 96; n++) {
              var t = n >> 3, r = n & 7, j = r >> 1, lane = (t % 2 === 0) === ((r & 1) === 0) ? 2 * j : 2 * j + 1;
              var bw = (4 * sw - 2) / 103;
              box(x0 + 1 + n * bw, gy, bw + 0.3, hh, th.lanes[lane]);
            }
            box(x0 + 1 + 96 * bw, gy, 7 * bw, hh, th.am);
            label('am_mapped<1027:0>', x0 + 2 * sw, gy - 9, th.ink, 10, 'center', 600);
          }
        } else {
          box(x + 1, y2, sw - 2, hh, th.edge);
          if (sw > 18) label(String(sl.block), x + sw / 2, y2 + hh / 2, th.paper, 9, 'center');
        }
      }
    }
    label('4 idle-sized slots (1028 bits) are left empty by rate matching', x0, y1 - 14, th.muted, 10);
    label('10280 bits = 1028-bit AM group + 36 × 257-bit blocks', x0, y2 + hh + 22, th.ink, 11, 'left', 600);
    label('colours = which lane’s marker each 10 bits belong to', x0, y2 + hh + 40, th.muted, 10);
  }

  // Pre-FEC distribution: tiles of the stream, alternating to m_A and m_B.
  function drawPrefec(W, H) {
    // Stream symbols 102.. are the first data symbols after the 1028-bit AM group.
    var x0 = 70, n = 32, tw = (W - x0 - 16) / n, y0 = 46, yA = 128, yB = 178, hh = 26, k = Math.min(step, n);
    label('stream', 8, y0 + hh / 2, th.muted, 11);
    label('m_A', 8, yA + hh / 2, th.ink, 11, 'left', 600);
    label('m_B', 8, yB + hh / 2, th.ink, 11, 'left', 600);
    // Character boundaries over the stream, to show symbols cutting through them.
    for (var t = 0; t < n; t++) {
      var sx = x0 + t * tw, sym = 102 + t, dealt = t < k;
      // The stream row keeps its characters visible; dealt symbols fade out of it.
      for (var b = 0; b < 10; b++) {
        var bit = P.pairBit(LENS_Q, 10 * sym + b);
        box(sx + b * tw / 10, y0, tw / 10 + 0.2, hh, mix(bitColor(10 * sym + b), th.paper, dealt ? 0.78 : 0.1));
        if (bit.src === 'b' && bit.bit === 0) {
          ctx.fillStyle = th.paper; ctx.fillRect(sx + b * tw / 10, y0, 1.5, hh);
          // The character label sits over its first bit and reaches into the next symbol.
          if (tw > 18) label(P.glyph(P.byteAt(bit.idx)), sx + (b + 4) * tw / 10, y0 - 9, th.ink, 11, 'center', 600);
        }
      }
      box(sx, y0, tw, hh, null, th.paper);
      if (dealt) {
        var w = sym & 1, yy = w ? yB : yA, i = sym >> 1;
        box(sx + 1, yy, tw - 2, hh, w ? th.b : th.a);
        if (tw > 22) label((w ? 'B' : 'A') + i, sx + tw / 2, yy + hh / 2, w ? th.ink : th.paper, tw > 30 ? 10 : 8, 'center', 600);
      }
    }
    if (k > 0 && k < n) {
      var cx = x0 + (k - 0.5) * tw, last = 102 + k - 1;
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1.2; ctx.beginPath();
      ctx.moveTo(cx, y0 + hh + 2); ctx.lineTo(cx, ((last & 1) ? yB : yA) - 2); ctx.stroke();
    }
    label('m_A symbol i = stream bits 20·i to 20·i+9    m_B symbol i = bits 20·i+10 to 20·i+19    (119.2.4.5)', x0, H - 20, th.ink, 11, 'left', 600);
    label('white ticks mark where each 8-bit character starts; a 10-bit symbol always cuts through one', x0, H - 38, th.muted, 10);
  }

  // RS(544,514): two strips of 544 cells filling, then 30 parity cells.
  function drawRs(W, H) {
    var x0 = 70, cw = (W - x0 - 16) / 544, yA = 56, yB = 122, hh = 40, k = Math.min(step, 544);
    [0, 1].forEach(function (w) {
      var y = w ? yB : yA;
      label(w ? 'codeword B' : 'codeword A', 8, y + hh / 2, th.ink, 10, 'left', 600);
      box(x0, y, 544 * cw, hh, null, th.rule);
      for (var i = 0; i < Math.min(k, 544); i++) {
        var col = i >= 514 ? th.ink : i < 48 ? mix(w ? th.b : th.a, th.am, 0.6) : (w ? th.b : th.a);
        box(x0 + i * cw, y, Math.max(cw, 0.6) + 0.2, hh, col);
      }
    });
    var xP = x0 + 514 * cw;
    ctx.strokeStyle = th.ink; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xP, yA - 8); ctx.lineTo(xP, yB + hh + 8); ctx.stroke(); ctx.setLineDash([]);
    label('514 message symbols (5140 bits)', x0 + 257 * cw, yA - 14, th.muted, 10, 'center');
    label('30 parity', x0 + 529 * cw, yA - 14, k >= 514 ? th.ink : th.muted, 10, 'center', 600);
    var msg = k < 514 ? 'message symbols in: ' + k + ' / 514' : 'parity appended: ' + (k - 514) + ' / 30';
    label(msg, x0, yB + hh + 24, th.ink, 12, 'left', 600);
    label('amber = symbols holding the AM group; dark = parity. 544 = 514 + 30, corrects up to 15 symbol errors', x0, yB + hh + 44, th.muted, 10);
  }

  // Symbol distribution: tx_out order dealt onto 8 lanes, one symbol at a time.
  function drawDist(W, H) {
    // 16 columns: 12 marker symbols, then the first 4 data symbols of each lane.
    var x0 = 70, cols = 16, cw = Math.min(56, (W - x0 - 16) / cols), rh = 28, y0 = 50, k = Math.min(step, 8 * cols);
    label('even k: lanes 0,2,4,6 take A, odd lanes take B; odd k swaps them. tx_out symbol s goes to PCS lane s mod 8 (119.2.4.8)', x0, 18, th.ink, 11, 'left', 600);
    ctx.strokeStyle = th.ink; ctx.setLineDash([3, 3]); ctx.beginPath();
    ctx.moveTo(x0 + 12 * cw, y0 - 4); ctx.lineTo(x0 + 12 * cw, y0 + 8 * rh + 4); ctx.stroke(); ctx.setLineDash([]);
    label('marker (120 bits)', x0 + 6 * cw, y0 - 10, th.muted, 10, 'center');
    label('data', x0 + 14 * cw, y0 - 10, th.muted, 10, 'center');
    for (var p = 0; p < 8; p++) {
      var y = y0 + p * rh;
      box(4, y + 4, 10, rh - 8, th.lanes[p]);
      label('PCS ' + p, 20, y + rh / 2, th.ink, 11, 'left', 600);
      for (var kk = 0; kk < cols; kk++) {
        var s = 8 * kk + p, x = x0 + kk * cw;
        if (s >= k) { box(x + 1, y + 2, cw - 2, rh - 4, null, th.rule); continue; }
        var id = P.laneSymbolId(p, kk), cs = P.cwSymbol(LENS_Q, id.w, id.i);
        var am = !cs.parity && cs.parts.some(function (pt) { return pt.src === 'am'; });
        var col = am ? th.lanes[p] : id.w ? th.b : th.a;
        box(x + 1, y + 2, cw - 2, rh - 4, col);
        label((id.w ? 'B' : 'A') + id.i, x + cw / 2, y + rh / 2, am || !id.w ? th.paper : th.ink, 10, 'center', 600);
      }
    }
    var nxt = Math.min(k, 8 * cols - 1);
    label(k < 8 * cols ? 'next: tx_out symbol ' + nxt + ' → PCS ' + (nxt % 8) : 'each lane’s first 12 symbols are its own am_x (lane colour); data follows in a checkerboard of A and B',
      x0, y0 + 8 * rh + 18, th.muted, 10);
  }

  // PMA bit-mux: the PCS lanes of one SerDes lane, bit by bit.
  function drawMux(W, H) {
    var link = S.link, kk = link.k, x0 = 70, nb = 40, bw = (W - x0 - 16) / nb, rh = 22, y0 = 40;
    var lanes = P.lanesOnSerdes(link, 0), k = Math.min(step, nb * kk);
    label(kk === 1 ? 'One PCS lane per SerDes lane: no multiplexing at 8 lanes' : kk + ' PCS lanes bit-interleaved onto SerDes 0 (' + P.WIDTHS[S.width].mod + ')',
      x0, 16, th.ink, 11, 'left', 600);
    // Source PCS lanes: their own bits, in their own order (lane symbols 12+, data).
    lanes.forEach(function (l, r) {
      var y = y0 + r * rh;
      box(4, y + 3, 10, rh - 6, th.lanes[l.pcs]);
      label('PCS ' + l.pcs, 20, y + rh / 2, th.ink, 10, 'left', 600);
      for (var b = 0; b < nb / kk + 1; b++) {
        var x = x0 + b * bw * kk, used = b * kk + r < k;
        box(x + 1, y + 3, bw * kk - 2, rh - 6, used ? mix(th.lanes[l.pcs], th.paper, 0.7) : th.lanes[l.pcs]);
        if (bw * kk > 14) label(laneBit(l.pcs, b), x + bw * kk / 2, y + rh / 2, used ? th.muted : th.paper, 9, 'center');
      }
    });
    var ys = y0 + kk * rh + 30;
    label('SerDes 0', 8, ys + 14, th.ink, 10, 'left', 600);
    for (var t = 0; t < nb && t < k; t++) {
      var src = lanes[t % kk], x = x0 + t * bw;
      box(x + 1, ys, bw - 2, 28, th.lanes[src.pcs]);
      if (bw > 11) label(laneBit(src.pcs, Math.floor(t / kk)), x + bw / 2, ys + 14, th.paper, 9, 'center');
    }
    if (kk > 1 && S.width < 8) {
      for (var t2 = 0; t2 + 1 < Math.min(nb, k); t2 += 2) {
        var xx = x0 + t2 * bw;
        ctx.strokeStyle = th.muted; ctx.beginPath(); ctx.moveTo(xx + 2, ys + 32); ctx.lineTo(xx + 2, ys + 36); ctx.lineTo(xx + 2 * bw - 2, ys + 36); ctx.lineTo(xx + 2 * bw - 2, ys + 32); ctx.stroke();
      }
      label('brackets = PAM4 symbols (2 bits each); each carries one bit from two PCS lanes', x0, ys + 52, th.muted, 10);
    }
    label('every bit of a PCS lane takes the same SerDes lane and the same slot; the PMA never looks inside the data', x0, ys + 70, th.muted, 10);
  }
  // Bit b of PCS lane p, from lane symbol 16 on: past the 12-symbol marker and
  // the pad/status symbols, so the bits shown are text data.
  function laneBit(p, b) {
    var k = 16 + Math.floor(b / 10), id = P.laneSymbolId(p, k), s = P.cwSymbol(LENS_Q, id.w, id.i);
    return s.parity ? '·' : s.bits[b % 10];
  }

  // Caption under the lens, in words.
  P.lensNote = function () {
    var el = document.getElementById('lens-note');
    if (!el || !mode) return;
    var t = {
      am: 'The 257-bit stream with one AM pair. Rate matching has already deleted idles, leaving 4 empty slots at the start of the codeword pair. ' +
        'The 8 lane markers, interleaved 10 bits at a time, fill exactly that space. The standard inserts a group every 81,920 blocks (2,048 codeword pairs); the lab does it every pair.',
      prefec: 'The stream is cut into 10-bit symbols and dealt alternately: A0, B0, A1, B1, … Each codeword gets every other 10 bits, ' +
        'so a character usually ends up split between A and B.',
      rs: 'Each codeword takes 514 message symbols (the 5140 bits pre-FEC distribution gave it). The encoder then computes and appends ' +
        '30 parity symbols: 544 in total. The two codewords together are exactly 40 × 257 = 10,280 message bits.',
      dist: 'The two codewords are interleaved 10 bits at a time and dealt across PCS lanes 0–7 in turn. Lane 0 gets A0, B4, A8, B12, …; ' +
        'lane 1 gets B0, A4, B8, … Because of how the AM group was pre-arranged, each lane’s first 12 symbols are its own marker.',
      mux: 'The PMA interleaves the bits of the PCS lanes that share a SerDes lane: one bit from each in turn. Change SerDes lanes in the toolbar to see 1, 2 or 4 PCS lanes per SerDes lane.'
    }[mode];
    el.textContent = t;
  };
})(globalThis.PCS = globalThis.PCS || {});
