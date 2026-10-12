/* Step views: a pop-up that shows one PCS operation at bit scale, input on the
   left and output on the right. Clicking a stage box (or its label, or a Bit
   lens button) opens it on whatever unit is in that box right now; the scene
   pauses and Prev / Next walk to neighbouring units. The view starts complete;
   Animate replays it one unit at a time and Step advances by hand.

   Views:
     b66    64B/66B encode: 8 bytes in, sync header + the same 64 bits out
     b257   256B/257B transcode: four 66-bit blocks in, one 257-bit block out
     am     AM insertion: idles leave a 4-slot gap; the 1028-bit group drops in
     prefec pre-FEC distribution: 10-bit stream symbols dealt to m_A and m_B
     rs     RS(544,514): 514 message symbols each, then 30 parity symbols appended
     dist   symbol distribution: codewords A and B dealt onto 8 PCS lanes
     mux    PMA bit-mux: PCS lane bits interleaved onto SerDes lanes */
(function (P) {
  'use strict';
  var S = P.state, dlg, cv, ctx, dpr = 1, mode = null, cur = null;
  var step = 0, acc = 0, anim = false, stepping = false, dirty = true;
  var UPAIR = P.UNITS_PER_PAIR * P.GAP, U257 = UPAIR / P.PAIR_SLOTS, U66 = U257 / 4;

  function mod(a, n) { return ((a % n) + n) % n; }
  function boxMid(view) {
    var b = P.BOXES.find(function (x) { return x.view === view; });
    return (b.x[0] + b.x[1]) / 2;
  }
  // Pair q and how far (0..1) into its bits the box centre is. The scene moves
  // towards +x and a pair's first bit leads at S.u - q * UPAIR (packets.js).
  function pairAt(x) {
    var t = (S.u - x) / UPAIR, q = Math.floor(t);
    return { q: q, f: t - q };
  }
  function nextData66(t, d) { while (P.slot66(t).idle) t += d; return t; }
  function nextData257(s, d) { while (P.slot257(s).am) s += d; return s; }
  function cwName(w) { return w ? 'B' : 'A'; }

  /* ---- views: what is in the box, how to step, what to call it ---- */
  var VIEWS = {
    b66: { title: '64B/66B encode', stage: 2, steps: 9, rate: 3, h: 300,
      at: function () { return { t: nextData66(Math.round((S.u - boxMid('b66')) / U66), 1) }; },
      nav: function (c, d) { return { t: nextData66(c.t + d, d) }; },
      where: function (c) { var b = P.slot66(c.t).block; return '200GMII transfer ' + b + ' → 66-bit block ' + b; } },
    b257: { title: '256B/257B transcode', stage: 2, steps: 5, rate: 2.5, h: 340,
      at: function () { return { s: nextData257(Math.round((S.u - boxMid('b257')) / U257), 1) }; },
      nav: function (c, d) { return { s: nextData257(c.s + d, d) }; },
      where: function (c) {
        var sl = P.slot257(c.s);
        return '66-bit blocks ' + 4 * sl.block + '–' + (4 * sl.block + 3) + ' → 257-bit block ' + sl.block + ' (slot ' + (sl.r + 1) + ' of 40, pair ' + sl.q + ')';
      } },
    am: { title: 'AM insertion', stage: 3, steps: 40, rate: 8, h: 250,
      at: function () { var q = pairAt(boxMid('am')).q; return { q: q - mod(q, P.AM_PAIRS) }; },
      nav: function (c, d) { return { q: c.q + d * P.AM_PAIRS }; },
      where: function (c) { return 'Codeword pair ' + c.q + ': the AM group fills slots 1–4 of 40'; } },
    prefec: { title: 'Pre-FEC distribution', stage: 3, steps: 16, rate: 4, h: 360,
      at: function () {
        var p = pairAt(boxMid('prefec')), j = Math.floor(p.f * 1028) - 8;
        return { q: p.q, j: Math.max(0, Math.min(1012, j - mod(j, 2))) };
      },
      nav: function (c, d) {
        if (d > 0) return c.j >= 1012 ? { q: c.q + 1, j: 0 } : { q: c.q, j: Math.min(1012, c.j + 16) };
        return c.j <= 0 ? { q: c.q - 1, j: 1012 } : { q: c.q, j: Math.max(0, c.j - 16) };
      },
      where: function (c) {
        return 'Pair ' + c.q + ': stream symbols ' + c.j + '–' + (c.j + 15) + ' of 1028 → A' + c.j / 2 + '–A' + (c.j / 2 + 7) + ' and B' + c.j / 2 + '–B' + (c.j / 2 + 7);
      } },
    rs: { title: 'RS(544,514) encode', stage: 3, steps: 30, rate: 8, h: 316,
      at: function () { return { q: pairAt(boxMid('rs')).q }; },
      nav: function (c, d) { return { q: c.q + d }; },
      where: function (c) { return 'Codeword pair ' + c.q + ': A and B, 514 message symbols each → 544'; } },
    dist: { title: 'Symbol distribution', stage: 4, steps: 32, rate: 8, h: 376,
      at: function () { var p = pairAt(boxMid('dist')); return { q: p.q, u: Math.min(P.UNITS_PER_PAIR - 1, Math.floor(p.f * P.UNITS_PER_PAIR)) }; },
      nav: function (c, d) {
        var u = c.u + d, q = c.q;
        if (u < 0) { u = P.UNITS_PER_PAIR - 1; q--; } else if (u >= P.UNITS_PER_PAIR) { u = 0; q++; }
        return { q: q, u: u };
      },
      where: function (c) {
        return 'Pair ' + c.q + ': lane symbols ' + 4 * c.u + '–' + (4 * c.u + 3) + ' of 136 on every PCS lane' + (P.isAmPair(c.q) && c.u < P.AM_UNITS ? ' (alignment marker)' : '');
      } },
    mux: { title: 'PMA bit-mux', stage: 5, steps: 40, rate: 10, h: 0,
      at: function () { return { q: pairAt((P.X.mux[0] + P.X.mux[1]) / 2).q }; },
      where: function (c) { return 'Pair ' + c.q + ', PCS lane bits from lane symbol 16 on, onto SerDes 0'; } }
  };
  P.VIEWS = VIEWS;

  // Caption under each view, in words.
  var NOTES = {
    b66: 'Every 200GMII transfer of 8 data bytes becomes one 66-bit block: a 2-bit sync header, then the same 64 bits unchanged. ' +
      'Header 01 means all 8 bytes are data; 10 would mean the block carries control characters, which this model leaves out. Bit 0 of each byte is sent first.',
    b257: 'Four 66-bit blocks become one 257-bit block. When all four are data, their four 2-bit sync headers (8 bits) are replaced by a single header bit 1, ' +
      'and the four 64-bit payloads follow in order, unchanged: 4 × 66 = 264 bits become 257. The 7 bits saved per block make room for RS-FEC parity at the same line rate.',
    am: 'The 257-bit stream with one AM group. Rate matching has already deleted idles, leaving 4 empty slots at the start of the codeword pair. ' +
      'The 8 lane markers, interleaved 10 bits at a time, fill exactly that space. The standard inserts a group every 81,920 blocks (2,048 codeword pairs); the lab does it every pair.',
    prefec: 'The 10,280-bit block is read as 1028 ten-bit symbols, in order, and dealt alternately: stream symbol 2i goes to codeword A as A_i, symbol 2i+1 to codeword B as B_i. ' +
      'Nothing is changed or reordered within a symbol. Symbols ignore character boundaries, so most characters end up split between A and B.',
    rs: 'RS(544,514) is systematic: the 514 message symbols of each codeword pass through unchanged, and the encoder appends 30 new parity symbols computed from them ' +
      'over GF(2¹⁰). With 30 extra symbols the decoder can repair up to 15 bad symbols per codeword. Parity here is computed over the unscrambled bits the lab shows; a real link scrambles them first.',
    dist: 'Codewords A and B are interleaved 10 bits at a time and dealt across PCS lanes 0–7 in turn. On even lane symbols, lanes 0, 2, 4, 6 take A and lanes 1, 3, 5, 7 take B; odd lane symbols swap them. ' +
      'Each lane ends up with 136 symbols per codeword pair, half from each codeword. Tile colour is the lane a symbol goes to.',
    mux: 'The PMA interleaves the bits of the PCS lanes that share a SerDes lane: one bit from each in turn. Change SerDes lanes in the toolbar to see 1, 2 or 4 PCS lanes per SerDes lane.'
  };

  /* ---- drawing helpers ---- */
  var th;
  function font(sz, wt) { return (wt || 500) + ' ' + sz + 'px "IBM Plex Mono", ui-monospace, monospace'; }
  function box(x, y, w, h, fill, stroke, lw) {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
  }
  function label(s, x, y, col, sz, align, wt) {
    ctx.fillStyle = col || th.ink; ctx.font = font(sz || 11, wt); ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }
  // Largest of the candidate strings that fits in w at size sz; '' if none.
  function fit(list, w, sz, wt) {
    ctx.font = font(sz, wt);
    for (var i = 0; i < list.length; i++) if (ctx.measureText(list[i]).width <= w - 2) return list[i];
    return '';
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
    th = { ink: hexColor(t.ink), ink2: hexColor(P.css('--ink-2')), muted: hexColor(t.muted), paper: hexColor(P.css('--panel')), rule: hexColor(t.rule),
      am: hexColor(t.am), a: hexColor(t.cwA), b: hexColor(t.cwB), bad: hexColor(t.bad), edge: hexColor(t.edge),
      lanes: t.lanes.map(hexColor) };
    th.byte0 = mix(th.edge, th.paper, 0.72); th.byte1 = mix(th.edge, th.paper, 0.5);
  }
  // Light fills take ink text, dark fills take paper text.
  function onFill(fill) {
    var v = parseInt(fill.slice(1), 16), l = 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
    var dark = parseInt(th.paper.slice(1, 3), 16) < 128;
    return l > 150 ? (dark ? th.paper : th.ink) : (dark ? th.ink : th.paper);
  }
  function arrow(x0, x1, y) {
    ctx.strokeStyle = th.muted; ctx.fillStyle = th.muted; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1 - 6, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1 - 8, y - 5); ctx.lineTo(x1 - 8, y + 5); ctx.closePath(); ctx.fill();
  }
  function byteBits(c) { var s = ''; for (var n = 0; n < 8; n++) s += (c >> n) & 1; return s; }
  function glyph(c) { return c === 32 ? '·' : P.glyph(c); }
  // Byte tile: character, hex, and its 8 bits (bit 0 first).
  function byteTile(x, y, w, h, c, fill, ghost) {
    box(x, y, w, h, ghost ? null : fill, ghost ? th.rule : null);
    if (ghost) return;
    var tc = onFill(fill);
    label(glyph(c), x + w / 2, y + h * 0.27, tc, Math.min(16, h * 0.3), 'center', 600);
    if (h > 44) label(P.hex(c, 2), x + w / 2, y + h * 0.55, tc, 10, 'center');
    var b = fit([byteBits(c)], w, 9);
    if (b && h > 44) label(b, x + w / 2, y + h * 0.8, tc, 9, 'center');
  }
  function hdrTile(x, y, w, h, bits, cap, ghost) {
    box(x, y, w, h, ghost ? null : th.ink, ghost ? th.rule : null);
    if (ghost) return;
    label(bits, x + w / 2, y + h * 0.4, th.paper, 13, 'center', 700);
    if (cap && h > 34) label(fit([cap], w, 9), x + w / 2, y + h * 0.75, th.paper, 9, 'center');
  }
  // Which unit was added last while stepping or animating; -1 when idle.
  function hot() { return stepping && step > 0 ? step - 1 : -1; }

  /* ---- 64B/66B: 8 bytes in, 01 + the same 64 bits out ---- */
  function drawB66(W) {
    var blk = P.slot66(cur.t).block, start = 8 * blk, k = step, h = hot();
    var x0 = 116, hw = 54, gap = 8, tw = Math.min(84, (W - x0 - hw - gap - 16) / 8);
    var xb = x0 + hw + gap, yIn = 44, yOut = 150, th1 = 66;
    label('in: one 200GMII transfer, 8 data bytes', xb, 18, th.ink, 11, 'left', 600);
    label('200GMII', 8, yIn + th1 / 2 - 8, th.ink, 11, 'left', 600);
    label('64 bits in', 8, yIn + th1 / 2 + 8, th.muted, 10);
    label('66-bit block', 8, yOut + th1 / 2 - 8, th.ink, 11, 'left', 600);
    label('66 bits out', 8, yOut + th1 / 2 + 8, th.muted, 10);
    for (var b = 0; b < 8; b++) {
      var c = P.byteAt(start + b), x = xb + b * tw, fill = b & 1 ? th.byte1 : th.byte0;
      byteTile(x + 1, yIn, tw - 2, th1, c, fill, false);
      byteTile(x + 1, yOut, tw - 2, th1, c, fill, k < b + 2);
      if (h === b + 1) { box(x + 1, yIn, tw - 2, th1, null, th.ink, 2); box(x + 1, yOut, tw - 2, th1, null, th.ink, 2); }
      if (k >= b + 2) {
        ctx.strokeStyle = th.rule; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + tw / 2, yIn + th1 + 3); ctx.lineTo(x + tw / 2, yOut - 3); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    hdrTile(x0, yOut, hw, th1, '01', 'sync', k < 1);
    if (h === 0) box(x0, yOut, hw, th1, null, th.am, 3);
    label('8 bytes = 64 bits, unchanged', xb + 4 * tw, yIn + th1 + 14, th.muted, 10, 'center');
    label('+ 2-bit sync header', x0 + hw / 2, yOut - 12, k >= 1 ? th.ink : th.muted, 10, 'center', 600);
    // The 66 bits in the order they are sent.
    var ys = yOut + th1 + 30, cw = (W - x0 - 16) / 66;
    label('sent in order', 8, ys + 9, th.muted, 10);
    for (var n = 0; n < 66; n++) {
      var bx = x0 + n * cw, on = n < 2 ? k >= 1 : k >= 2 + ((n - 2) >> 3);
      var bit = n < 2 ? '01'[n] : String((P.byteAt(start + ((n - 2) >> 3)) >> ((n - 2) & 7)) & 1);
      var f = n < 2 ? th.ink : ((n - 2) >> 3) & 1 ? th.byte1 : th.byte0;
      box(bx + 0.5, ys, cw - 1, 18, on ? f : null, on ? null : th.rule);
      if (on && cw > 8) label(bit, bx + cw / 2, ys + 9, onFill(f), 9, 'center');
    }
    label('bit 0 → bit 65', x0, ys + 30, th.muted, 10);
  }

  /* ---- 256B/257B: four 66-bit blocks in, one 257-bit block out ---- */
  function drawB257(W) {
    var sl = P.slot257(cur.s), start = 32 * sl.block, k = step, h = hot();
    var mid = W / 2, x0 = 70, hw = 30, rh = 40, gap = 6, y0 = 44;
    var lw = (mid - 26 - x0 - hw - 4) / 8, rx = mid + 26, rw = (W - 16 - rx - hw - 4) / 8;
    label('in: 4 × 66-bit blocks', x0, 18, th.ink, 11, 'left', 600);
    label('out: 1 × 257-bit block', rx, 18, th.ink, 11, 'left', 600);
    for (var g = 0; g < 4; g++) {
      var y = y0 + g * (rh + gap), moved = k >= g + 2;
      label('#' + (4 * sl.block + g), 8, y + rh / 2, th.muted, 10);
      // Left: the 66-bit block, its header dropped once transcoding starts.
      hdrTile(x0, y, hw, rh, '01', '', false);
      if (k >= 1) {
        ctx.fillStyle = th.paper; ctx.globalAlpha = 0.65; ctx.fillRect(x0, y, hw, rh); ctx.globalAlpha = 1;
        ctx.strokeStyle = th.bad; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0 + 3, y + rh - 3); ctx.lineTo(x0 + hw - 3, y + 3); ctx.stroke();
      }
      for (var b = 0; b < 8; b++) {
        var c = P.byteAt(start + 8 * g + b), f = b & 1 ? th.byte1 : th.byte0;
        byteTile(x0 + hw + 4 + b * lw + 0.5, y, lw - 1, rh, c, moved && stepping ? mix(f, th.paper, 0.55) : f, false);
        byteTile(rx + hw + 4 + b * rw + 0.5, y, rw - 1, rh, c, f, !moved);
      }
      if (h === g + 1) { box(x0 + hw + 4, y, 8 * lw, rh, null, th.ink, 2); box(rx + hw + 4, y, 8 * rw, rh, null, th.ink, 2); }
    }
    var hH = 4 * rh + 3 * gap;
    hdrTile(rx, y0, hw, hH, '1', 'hdr', k < 1);
    if (h === 0) box(rx, y0, hw, hH, null, th.am, 3);
    arrow(mid - 18, mid + 18, y0 + hH / 2);
    var yb = y0 + hH + 14;
    label('4 × (2 + 64) = 264 bits', x0, yb, th.muted, 10);
    label('1 + 4 × 64 = 257 bits', rx, yb, th.muted, 10);
    label(k >= 1 ? 'the four 01 headers are dropped; one header bit 1 says “all four are data”' : 'each 66-bit block starts with sync header 01',
      x0, yb + 18, k >= 1 ? th.ink : th.muted, 10, 'left', k >= 1 ? 600 : 500);
    // The 257 bits in the order they are sent.
    var ys = yb + 50, cw = (W - x0 - 16) / 257;
    label('the 257 bits in the order they are sent', x0, ys - 10, th.muted, 10);
    box(x0, ys, Math.max(cw, 3), 16, k >= 1 ? th.ink : null, k >= 1 ? null : th.rule);
    for (var g2 = 0; g2 < 4; g2++) {
      var gx = x0 + (1 + 64 * g2) * cw, on = k >= g2 + 2;
      for (var b2 = 0; b2 < 8; b2++) box(gx + 8 * b2 * cw, ys, 8 * cw - 0.5, 16, on ? (b2 & 1 ? th.byte1 : th.byte0) : null, on ? null : th.rule);
      label('block ' + (4 * sl.block + g2) + ' payload', gx + 32 * cw, ys + 28, on ? th.ink2 : th.muted, 9, 'center');
    }
  }

  /* ---- pre-FEC distribution: the stream on the left, m_A over m_B on the right ---- */
  // Fill for stream bit b: by source character (two shades so neighbours differ),
  // the 257-bit header, or the AM group.
  function bitFill(q, b) {
    var s = P.pairBit(q, b);
    if (s.src === 'b') return s.idx & 1 ? th.byte1 : th.byte0;
    if (s.src === 'h') return th.ink;
    if (s.src === 'am') return th.lanes[s.lane];
    return th.am;
  }
  // A 10-bit symbol: a codeword-coloured name bar, its bits, and what they hold.
  function symTile(x, y, w, q, j, name, fade) {
    var w2 = j & 1, bar = w2 ? th.b : th.a, cw = w / 10, b0 = 10 * j;
    if (fade) ctx.globalAlpha = 0.28;
    box(x, y, w, 16, bar);
    label(fit([name + ' = ' + P.hex(P.cwSymbol(q, w2, j >> 1).value, 3), name], w, 10, 600), x + w / 2, y + 8, onFill(bar), 10, 'center', 600);
    for (var n = 0; n < 10; n++) {
      var f = bitFill(q, b0 + n);
      box(x + n * cw, y + 17, cw + 0.3, 20, f);
      if (cw > 8) label(String(P.pairBit(q, b0 + n).v), x + n * cw + cw / 2, y + 27, onFill(f), 9, 'center');
    }
    // What the bits hold: a character, a header bit, or AM bits, centred on its run.
    var n0 = 0;
    while (n0 < 10) {
      var s = P.pairBit(q, b0 + n0), n1 = n0 + 1;
      var key = s.src === 'b' ? 'b' + s.idx : s.src === 'am' ? 'am' + s.lane : s.src;
      while (n1 < 10) {
        var t = P.pairBit(q, b0 + n1), k2 = t.src === 'b' ? 'b' + t.idx : t.src === 'am' ? 'am' + t.lane : t.src;
        if (k2 !== key) break;
        n1++;
      }
      var txt = s.src === 'b' ? glyph(P.byteAt(s.idx)) : s.src === 'h' ? 'h' : s.src === 'am' ? (n1 - n0 > 3 ? 'am' + s.lane : '') : '';
      if (txt) label(txt, x + (n0 + n1) / 2 * cw, y + 47, th.ink2, 11, 'center', 600);
      if (n0 > 0) box(x + n0 * cw - 0.5, y + 17, 1.5, 20, th.paper);
      n0 = n1;
    }
    ctx.globalAlpha = 1;
  }
  function drawPrefec(W) {
    var q = cur.q, j0 = cur.j, k = step, h = hot();
    var mid = W / 2, x0 = 70, lx1 = mid - 26, rx = mid + 26, rx1 = W - 16, g = 6;
    var lw = (lx1 - x0 - 3 * g) / 4, rw = (rx1 - rx - 3 * g) / 4, rh = 58, rg = 12, y0 = 44;
    label('in: the bit stream, 10 bits per symbol', x0, 18, th.ink, 11, 'left', 600);
    label('out: two messages', rx, 18, th.ink, 11, 'left', 600);
    for (var r = 0; r < 4; r++) label(String(j0 + 4 * r), 8, y0 + r * (rh + rg) + 27, th.muted, 10);
    var yA = y0, yB = y0 + 2 * (rh + rg);
    label('m_A', rx - 8, yA + rh, th.ink, 11, 'right', 700);
    label('m_B', rx - 8, yB + rh, th.ink, 11, 'right', 700);
    function lpos(t) { return [x0 + (t % 4) * (lw + g), y0 + Math.floor(t / 4) * (rh + rg)]; }
    function rpos(t) { var i = t >> 1, w2 = t & 1; return [rx + (i % 4) * (rw + g), (w2 ? yB : yA) + Math.floor(i / 4) * (rh + rg)]; }
    for (var t = 0; t < 16; t++) {
      var j = j0 + t, name = (j & 1 ? 'B' : 'A') + (j >> 1), L = lpos(t), R = rpos(t);
      symTile(L[0], L[1], lw, q, j, 's' + j, k > t && stepping);
      if (k > t) symTile(R[0], R[1], rw, q, j, name, false);
      else box(R[0], R[1], rw, 37, null, th.rule);
      if (t === h) {
        box(L[0] - 2, L[1] - 2, lw + 4, 41, null, th.ink, 2); box(R[0] - 2, R[1] - 2, rw + 4, 41, null, th.ink, 2);
        ctx.strokeStyle = th.ink; ctx.lineWidth = 1.2; ctx.beginPath();
        ctx.moveTo(L[0] + lw + 2, L[1] + 18); ctx.bezierCurveTo(mid, L[1] + 18, mid, R[1] + 18, R[0] - 2, R[1] + 18); ctx.stroke();
      }
    }
    if (h < 0) arrow(mid - 18, mid + 18, y0 + 2 * (rh + rg) - rg / 2);
    var yc = y0 + 4 * (rh + rg) + 4;
    label('even symbols go to A, odd to B: A_i = stream bits 20i…20i+9, B_i = bits 20i+10…20i+19 (119.2.4.5)', x0, yc, th.ink, 10, 'left', 600);
    label('bit shading changes at each character boundary; ' + (P.isAmPair(q) && j0 < 102 ? 'lane colours = alignment-marker bits, ' : '') + 'dark = 257-bit block header', x0, yc + 18, th.muted, 10);
  }

  /* ---- RS(544,514): 514 message symbols in, the same 514 + 30 parity out ---- */
  function msgTile(x, y, w, h, q, cw, i) {
    if (i < 0) {
      label('⋯', x + w / 2, y + h * 0.38, th.muted, 14, 'center', 700);
      label(fit(['+509', ''], w, 9), x + w / 2, y + h * 0.72, th.muted, 9, 'center');
      return;
    }
    var s = P.cwSymbol(q, cw, i), am = s.parts.some(function (pt) { return pt.src === 'am' || pt.src === 'pad' || pt.src === 'sf'; });
    var fill = am ? mix(cw ? th.b : th.a, th.am, 0.6) : cw ? th.b : th.a, tc = onFill(fill);
    box(x + 1, y, w - 2, h, fill);
    label(fit([cwName(cw) + i, String(i)], w - 2, 10, 600), x + w / 2, y + h * 0.3, tc, 10, 'center', 600);
    label(fit([P.hex(s.value, 3)], w - 2, 10), x + w / 2, y + h * 0.68, tc, 10, 'center');
  }
  function drawRs(W) {
    var q = cur.q, k = step, h = hot();
    var x0 = 96, tw = Math.min(46, (W - 166) / 18.2), pw = tw * 0.62, th1 = 54, ph = 16, pg = 3, y0 = 44;
    var rx = x0 + 6 * tw + 44, px = rx + 6 * tw + 10, idx = [0, 1, 2, -1, 512, 513];
    label('in: message, 514 symbols', x0, 18, th.ink, 11, 'left', 600);
    label('out: codeword, 544 symbols', rx, 18, th.ink, 11, 'left', 600);
    [0, 1].forEach(function (w) {
      var y = y0 + w * (th1 + 40), par = P.cwParity(q, w);
      label('codeword ' + cwName(w), 8, y + th1 / 2, th.ink, 11, 'left', 700);
      idx.forEach(function (i, n) { msgTile(x0 + n * tw, y, tw, th1, q, w, i); msgTile(rx + n * tw, y, tw, th1, q, w, i); });
      arrow(x0 + 6 * tw + 8, rx - 8, y + th1 / 2);
      for (var p = 0; p < 30; p++) {
        var cx = px + (p % 10) * pw, cy = y + Math.floor(p / 10) * (ph + pg);
        if (p < k) {
          box(cx + 0.5, cy, pw - 1, ph, th.ink);
          var hx = P.hex(par[p], 3), fs = fit([hx], pw - 1, 9) ? 9 : fit([hx], pw, 8) ? 8 : fit([hx], pw + 1, 7) ? 7 : 0;
          if (fs) label(hx, cx + pw / 2, cy + ph / 2, th.paper, fs, 'center');
        } else box(cx + 0.5, cy, pw - 1, ph, null, th.rule);
        if (p === h) box(cx - 1, cy - 1, pw + 1, ph + 2, null, th.am, 2);
      }
      label('514, unchanged', rx + 3 * tw, y + th1 + 12, th.muted, 10, 'center');
      label('+ 30 parity, new', px + 5 * pw, y + th1 + 12, k ? th.ink : th.muted, 10, 'center', 600);
    });
    // Length to scale: the output is the input with 30 symbols appended.
    var yb = y0 + 2 * th1 + 64, bw = W - 16 - x0, m = bw * 514 / 544;
    label('in', 8, yb + 6, th.muted, 10); box(x0, yb, m, 12, th.a);
    label('out', 8, yb + 24, th.muted, 10); box(x0, yb + 18, m, 12, th.a); box(x0 + m, yb + 18, (bw - m) * Math.min(1, k / 30), 12, th.ink);
    box(x0 + m, yb + 18, bw - m, 12, null, th.rule);
    label('to scale: the first 514 symbols out are the input, bit for bit; only the last 30 are new', x0, yb + 48, th.ink, 10, 'left', 600);
    label((P.isAmPair(q) ? 'amber = symbols holding the AM group; ' : '') + 'dark = parity, hex values shown', x0, yb + 66, th.muted, 10);
    label('parity = remainder of m(x)·x³⁰ ÷ g(x), g(x) = (x−α⁰)(x−α¹)…(x−α²⁹) over GF(2¹⁰) (Clause 91)', x0, yb + 84, th.muted, 10);
  }

  /* ---- symbol distribution: A and B on the left, 8 PCS lanes on the right ---- */
  function drawDist(W) {
    var q = cur.q, u = cur.u, k0 = 4 * u, i0 = 4 * k0, k = step, h = hot();
    var mid = Math.round(W * 0.47), x0 = 96, lw = (mid - 30 - x0) / 16, rx = mid + 74, rw = (W - 16 - rx) / 4;
    var rh = 30, y0 = 50, yA = y0 + 3 * rh - 6, yB = yA + 2 * rh + 12, am = P.isAmPair(q) && u < P.AM_UNITS;
    label('in: codewords A and B, symbols ' + i0 + '–' + (i0 + 15), x0, 18, th.ink, 11, 'left', 600);
    label('out: PCS lanes, lane symbols ' + k0 + '–' + (k0 + 3), rx - 60, 18, th.ink, 11, 'left', 600);
    // Lane symbol kk of lane p is codeword symbol 4kk + (p >> 1) of A or B, so
    // codeword symbol i sits at lane symbol i >> 2, on lane 2(i & 3) + (w xor parity of i >> 2).
    function dest(w, i) { var kk = i >> 2; return { p: 2 * (i & 3) + (w ^ (kk & 1)), kk: kk }; }
    // tx_out order within the window: symbol 8c + p goes to lane p, column c.
    function order(p, c) { return 8 * c + p; }
    function laneFill(p, i) { return i >= P.CW_K ? mix(th.lanes[p], th.ink, 0.45) : th.lanes[p]; }
    [0, 1].forEach(function (w) {
      var y = w ? yB : yA;
      label('codeword ' + cwName(w), 8, y + rh / 2, th.ink, 11, 'left', 700);
      for (var n = 0; n < 16; n++) {
        var i = i0 + n, d = dest(w, i), o = order(d.p, d.kk - k0), x = x0 + n * lw, f = laneFill(d.p, i);
        if (stepping && k > o) ctx.globalAlpha = 0.28;
        box(x + 1, y, lw - 2, rh, f);
        var s = fit([cwName(w) + i, String(i), String(i % 100)], lw - 2, 10, 600);
        if (s) label(s, x + lw / 2, y + rh / 2, onFill(f), 10, 'center', 600);
        ctx.globalAlpha = 1;
      }
    });
    arrow(mid - 22, mid + 14, (yA + yB + rh) / 2);
    for (var p = 0; p < 8; p++) {
      var y = y0 + p * (rh + 6) - 6;
      box(rx - 64, y + 7, 8, rh - 14, th.lanes[p]);
      label('PCS ' + p, rx - 50, y + rh / 2, th.ink, 11, 'left', 600);
      for (var c = 0; c < 4; c++) {
        var id = P.laneSymbolId(p, k0 + c), x = rx + c * rw, o = order(p, c);
        if (k <= o) { box(x + 1, y, rw - 2, rh, null, th.rule); continue; }
        var cs = P.cwSymbol(q, id.w, id.i), f = laneFill(p, id.i);
        box(x + 1, y, rw - 2, rh, f);
        label(fit([cwName(id.w) + id.i + ' = ' + P.hex(cs.value, 3), cwName(id.w) + id.i], rw - 2, 10, 600), x + rw / 2, y + rh / 2, onFill(f), 10, 'center', 600);
        if (o === h) {
          box(x - 1, y - 2, rw + 2, rh + 4, null, th.ink, 2);
          var n2 = id.i - i0, ly = id.w ? yB : yA, lx = x0 + n2 * lw;
          box(lx - 1, ly - 2, lw + 2, rh + 4, null, th.ink, 2);
          ctx.strokeStyle = th.ink; ctx.lineWidth = 1.2; ctx.beginPath();
          var sy = id.w ? ly + rh + 2 : ly - 2;
          ctx.moveTo(lx + lw / 2, sy); ctx.bezierCurveTo(lx + lw / 2, id.w ? sy + 30 : sy - 30, x - 40, y + rh / 2, x - 1, y + rh / 2); ctx.stroke();
        }
      }
    }
    var yc = y0 + 8 * (rh + 6) + 6;
    label('tx_out symbol s goes to PCS lane s mod 8; lane p gets codeword symbol 4k + ⌊p/2⌋ of A or B at lane symbol k (119.2.4.8)', x0, yc, th.ink, 10, 'left', 600);
    label(am ? 'these are the alignment-marker symbols: every lane receives its own 120-bit marker, 10 bits at a time'
      : 'tile colour = destination lane; ' + (i0 + 15 >= P.CW_K ? 'darker = parity symbols' : 'the same codeword symbol index lands on lane 2(i mod 4) or the one after it'), x0, yc + 18, th.muted, 10);
  }

  /* ---- AM insertion and PMA bit-mux ---- */
  // 40 slots of one codeword pair. Before: 4 idle slots then 36 blocks. The
  // group falls into the gap as the cursor reaches it.
  function drawAm(W) {
    var q = cur.q, x0 = 70, sw = (W - x0 - 16) / 40, y1 = 52, y2 = 150, hh = 34, k = step;
    label('before', 8, y1 + hh / 2, th.muted, 11);
    label('after', 8, y2 + hh / 2, th.muted, 11);
    for (var s = 0; s < 40; s++) {
      var x = x0 + s * sw, sl = P.slot257(q * 40 + s);
      if (sl.am) box(x + 1, y1, sw - 2, hh, null, th.rule);
      else { box(x + 1, y1, sw - 2, hh, th.edge); if (sw > 18) label(String(sl.block), x + sw / 2, y1 + hh / 2, th.paper, 9, 'center'); }
      if (s >= k && sl.am) continue;
      if (sl.am) {
        if (s !== 0) continue;
        var fall = Math.min(1, k / 4), gy = y1 + (y2 - y1) * fall, bw = (4 * sw - 2) / 103;
        for (var n = 0; n < 96; n++) {
          var t = n >> 3, r = n & 7, j = r >> 1, lane = (t % 2 === 0) === ((r & 1) === 0) ? 2 * j : 2 * j + 1;
          box(x0 + 1 + n * bw, gy, bw + 0.3, hh, th.lanes[lane]);
        }
        box(x0 + 1 + 96 * bw, gy, 7 * bw, hh, th.am);
        label('am_mapped<1027:0>', x0 + 2 * sw, gy - 9, th.ink, 10, 'center', 600);
      } else if (s < k) {
        box(x + 1, y2, sw - 2, hh, th.edge);
        if (sw > 18) label(String(sl.block), x + sw / 2, y2 + hh / 2, th.paper, 9, 'center');
      } else box(x + 1, y2, sw - 2, hh, null, th.rule);
    }
    label('4 idle-sized slots (1028 bits) are left empty by rate matching', x0, y1 - 14, th.muted, 10);
    label('10280 bits = 1028-bit AM group + 36 × 257-bit blocks', x0, y2 + hh + 22, th.ink, 11, 'left', 600);
    label('colours = which lane’s marker each 10 bits belong to', x0, y2 + hh + 40, th.muted, 10);
  }

  // The PCS lanes of one SerDes lane, bit by bit.
  function drawMux(W) {
    var link = S.link, kk = link.k, x0 = 70, nb = 40, bw = (W - x0 - 16) / nb, rh = 22, y0 = 40, k = step;
    var lanes = P.lanesOnSerdes(link, 0);
    label(kk === 1 ? 'One PCS lane per SerDes lane: no multiplexing at 8 lanes' : kk + ' PCS lanes bit-interleaved onto SerDes 0 (' + P.WIDTHS[S.width].mod + ')',
      x0, 16, th.ink, 11, 'left', 600);
    lanes.forEach(function (l, r) {
      var y = y0 + r * rh;
      box(4, y + 3, 10, rh - 6, th.lanes[l.pcs]);
      label('PCS ' + l.pcs, 20, y + rh / 2, th.ink, 10, 'left', 600);
      for (var b = 0; b < nb / kk; b++) {
        var x = x0 + b * bw * kk, used = stepping && b * kk + r < k;
        box(x + 1, y + 3, bw * kk - 2, rh - 6, used ? mix(th.lanes[l.pcs], th.paper, 0.7) : th.lanes[l.pcs]);
        if (bw * kk > 14) label(laneBit(l.pcs, b), x + bw * kk / 2, y + rh / 2, used ? th.muted : th.paper, 9, 'center');
      }
    });
    var ys = y0 + kk * rh + 30;
    label('SerDes 0', 8, ys + 14, th.ink, 10, 'left', 600);
    for (var t = 0; t < nb; t++) {
      var src = lanes[t % kk], x = x0 + t * bw;
      if (t >= k) { box(x + 1, ys, bw - 2, 28, null, th.rule); continue; }
      box(x + 1, ys, bw - 2, 28, th.lanes[src.pcs]);
      if (bw > 11) label(laneBit(src.pcs, Math.floor(t / kk)), x + bw / 2, ys + 14, th.paper, 9, 'center');
    }
    if (kk > 1) {
      for (var t2 = 0; t2 + 1 < Math.min(nb, k); t2 += 2) {
        var xx = x0 + t2 * bw;
        ctx.strokeStyle = th.muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xx + 2, ys + 32); ctx.lineTo(xx + 2, ys + 36); ctx.lineTo(xx + 2 * bw - 2, ys + 36); ctx.lineTo(xx + 2 * bw - 2, ys + 32); ctx.stroke();
      }
      label('brackets = PAM4 symbols (2 bits each); each carries one bit from two PCS lanes', x0, ys + 52, th.muted, 10);
    }
    label('every bit of a PCS lane takes the same SerDes lane and the same slot; the PMA never looks inside the data', x0, ys + 70, th.muted, 10);
  }
  // Bit b of PCS lane p, from lane symbol 16 on: past the 12-symbol marker and
  // the pad/status symbols, so the bits shown are text data.
  function laneBit(p, b) {
    var k = 16 + Math.floor(b / 10), id = P.laneSymbolId(p, k);
    return P.cwSymbol(cur.q, id.w, id.i).bits[b % 10];
  }

  var DRAW = { b66: drawB66, b257: drawB257, am: drawAm, prefec: drawPrefec, rs: drawRs, dist: drawDist, mux: drawMux };
  function height() { return mode === 'mux' ? 152 + 22 * S.link.k : VIEWS[mode].h; }

  function size() {
    if (!cv || !mode) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Narrow screens scroll the view sideways rather than squeezing 10-bit tiles.
    var w = Math.max(620, cv.parentElement.clientWidth), h = height();
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    dirty = true; draw();
  }

  function draw() {
    if (!ctx || !mode || !dirty) return;
    dirty = false;
    if (!th) theme();
    var W = cv.width / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, cv.height / dpr);
    DRAW[mode](W);
  }

  function $(id) { return document.getElementById(id); }
  function sync() {
    var v = VIEWS[mode], N = v.steps;
    $('opv-where').textContent = v.where(cur);
    $('opv-prev').hidden = $('opv-next').hidden = !v.nav;
    $('opv-play').textContent = anim ? 'Pause' : step < N ? 'Play' : 'Animate';
    $('opv-count').textContent = stepping ? Math.min(step, N) + ' / ' + N : '';
    cv.setAttribute('aria-label', v.title + '. ' + v.where(cur) + '.');
    dirty = true; draw();
  }

  // Open view m on the unit that is in its box right now.
  P.openView = function (m) {
    if (!dlg || !VIEWS[m]) return;
    if (P.inspectorOpen && P.inspectorOpen()) P.closeInspector();
    if (S.playing) P.setPlaying(false);
    mode = m; cur = VIEWS[m].at();
    step = VIEWS[m].steps; anim = stepping = false; acc = 0;
    $('opv-title').textContent = VIEWS[m].title;
    $('opv-note').textContent = NOTES[m];
    if (!dlg.open) dlg.showModal();
    size(); sync();
  };
  P.closeView = function () { if (dlg && dlg.open) dlg.close(); };
  P.viewOpen = function () { return !!mode; };

  function playToggle() {
    if (!mode) return;
    var N = VIEWS[mode].steps;
    if (anim) anim = false;
    else { if (step >= N) step = 0; anim = stepping = true; acc = 0; }
    sync();
  }
  P.viewStep = function () {
    if (!mode) return false;
    var N = VIEWS[mode].steps;
    anim = false; stepping = true;
    step = step >= N ? 1 : step + 1;
    sync();
    return true;
  };
  function nav(d) {
    var v = VIEWS[mode];
    if (!v || !v.nav) return;
    cur = v.nav(cur, d);
    step = v.steps; anim = stepping = false;
    sync();
  }

  // Called every frame; only redraws when something changed.
  P.viewTick = function (dt) {
    if (!mode) return;
    if (anim) {
      var N = VIEWS[mode].steps;
      acc += dt * VIEWS[mode].rate;
      var n = Math.floor(acc);
      if (n) { acc -= n; step = Math.min(N, step + n); if (step >= N) anim = false; sync(); }
    }
    draw();
  };
  P.viewRecolor = function () { th = null; dirty = true; draw(); };

  P.initViews = function () {
    dlg = $('opview');
    if (!dlg) return;
    cv = $('opv-canvas'); ctx = cv.getContext('2d');
    document.querySelectorAll('[data-view]').forEach(function (b) {
      if (b.tagName === 'BUTTON') b.addEventListener('click', function () { P.openView(b.dataset.view); });
    });
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) { dlg.close(); return; }     // backdrop
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var a = b.dataset.act;
      if (a === 'close') dlg.close();
      else if (a === 'prev' || a === 'next') nav(a === 'next' ? 1 : -1);
      else if (a === 'play') playToggle();
      else if (a === 'step') P.viewStep();
    });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { nav(e.key === 'ArrowRight' ? 1 : -1); e.preventDefault(); }
    });
    // The close event is queued; a view reopened in the meantime must survive it.
    dlg.addEventListener('close', function () { if (!dlg.open) { mode = null; cur = null; anim = stepping = false; } });
    new ResizeObserver(function () { if (mode) size(); }).observe($('opv-wrap'));
    P.on(function (what) { if (mode && (what === 'link' || what === 'payload')) { if (mode === 'mux') size(); sync(); } });
  };
})(globalThis.PCS = globalThis.PCS || {});
