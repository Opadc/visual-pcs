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
  var pick = -1;   // AM view: the clicked slot 0-79, or -1
  var pfPage = 0;  // pre-FEC view: 0 = overview, 1 = the actual bits
  var distPage = 0; // symbol dist view: 0 = overview, 1 = the detail
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
  var PF_SYMS = 8, PF_LAST = 1028 - PF_SYMS;
  var VIEWS = {
    b66: { title: '64B/66B encode', stage: 2, steps: 9, rate: 3, h: 300,
      at: function () { return { t: nextData66(Math.round((S.u - boxMid('b66')) / U66), 1) }; },
      nav: function (c, d) { return { t: nextData66(c.t + d, d) }; },
      where: function (c) { var b = P.slot66(c.t).block; return '200GMII transfer ' + b + ' → 66-bit block ' + b; } },
    b257: { title: '256B/257B transcode', stage: 2, steps: 5, rate: 2.5, h: 316,
      at: function () { return { s: nextData257(Math.round((S.u - boxMid('b257')) / U257), 1) }; },
      nav: function (c, d) { return { s: nextData257(c.s + d, d) }; },
      where: function (c) {
        var sl = P.slot257(c.s);
        return '66-bit blocks ' + 4 * sl.block + '–' + (4 * sl.block + 3) + ' → 257-bit block ' + sl.block + ' (slot ' + (sl.r + 1) + ' of 40, pair ' + sl.q + ')';
      } },
    am: { title: 'AM insertion', stage: 3, steps: 0, rate: 6, h: 448,   // steps: AM_STEPS, set below
      at: function () { var q = pairAt(boxMid('am')).q; return { q: q - mod(q, P.AM_PAIRS) }; },
      nav: function (c, d) { return { q: c.q + d * P.AM_PAIRS }; },
      where: function (c) {
        var b = P.slot257(c.q * P.PAIR_SLOTS + P.AM_SLOTS).block;
        return 'AM insertion ' + c.q / P.AM_PAIRS + ': 4 AM blocks, then 257-bit blocks ' + b + '–' + (b + 2 * P.PAIR_SLOTS - P.AM_SLOTS - 1) + ' in slots 4–79';
      } },
    // PF_SYMS stream symbols per window: the most that fit on one row with readable bits.
    prefec: { title: 'Pre-FEC distribution · Distribution details', stage: 3, steps: PF_SYMS, rate: 3, h: 330,
      at: function () {
        var p = pairAt(boxMid('prefec')), j = Math.floor(p.f * 1028) - PF_SYMS / 2;
        return { q: p.q, j: Math.max(0, Math.min(PF_LAST, j - mod(j, 2))) };
      },
      nav: function (c, d) {
        if (d > 0) return c.j >= PF_LAST ? { q: c.q + 1, j: 0 } : { q: c.q, j: Math.min(PF_LAST, c.j + PF_SYMS) };
        return c.j <= 0 ? { q: c.q - 1, j: PF_LAST } : { q: c.q, j: Math.max(0, c.j - PF_SYMS) };
      },
      where: function (c) {
        var n = PF_SYMS / 2 - 1;
        return 'Pair ' + c.q + ': stream symbols ' + c.j + '–' + (c.j + PF_SYMS - 1) + ' of 1028 → A' + c.j / 2 + '–A' + (c.j / 2 + n) + ' and B' + c.j / 2 + '–B' + (c.j / 2 + n);
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

  // 257-bit blocks from one AM group to the next: standard and lab.
  var AM_STD = P.AM_PAIRS_STD * P.PAIR_SLOTS, AM_LAB = P.AM_PAIRS * P.PAIR_SLOTS;
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // Caption under each view, in words.
  var NOTES = {
    b66: 'Every 200GMII transfer of 8 data bytes becomes one 66-bit block: a 2-bit sync header, then the same 64 bits unchanged. ' +
      'Header 01 means all 8 bytes are data; 10 would mean the block carries control characters, which this model leaves out. Bit 0 of each byte is sent first.',
    b257: 'Four 66-bit blocks become one 257-bit block. When all four are data, their four 2-bit sync headers (8 bits) are replaced by a single header bit 1, ' +
      'and the four 64-bit payloads follow in order, unchanged: 4 × 66 = 264 bits become 257. The 7 bits saved per block make room for RS-FEC parity at the same line rate.',
    am: 'As in IEEE 802.3 Figure 119–6, the PCS inserts 4 AM blocks (am_mapped, 4 × 257 = 1028 bits) once every ' + num(AM_STD) + ' × 257-bit blocks, ' +
      'so ' + num(AM_STD - P.AM_SLOTS) + ' blocks of data pass between one group and the next. Rate matching has already deleted idles to leave the 4-block gap; ' +
      'the 8 lane markers, interleaved 10 bits at a time, plus a pad and status field fill it exactly. The lab inserts a group every ' + AM_LAB + ' blocks so markers keep passing on screen.',
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

  /* ---- 256B/257B, laid out like the transcoder figure (Example 1: all data
     blocks): tx_coded_0..3 end to end on top, tx_xcoded below. Each 01 header
     collapses to a boundary, so d_0..d_3 sit directly under their source. ---- */
  function payload(x, y, w, h, start, ghost, fade) {
    var bw = w / 8;
    for (var b = 0; b < 8; b++) {
      var c = P.byteAt(start + b), f = b & 1 ? th.byte1 : th.byte0, bx = x + b * bw;
      if (ghost) { box(bx + 0.5, y, bw - 1, h, null, th.rule); continue; }
      if (fade) f = mix(f, th.paper, 0.55);
      box(bx + 0.5, y, bw - 1, h, f);
      var tc = onFill(f), hx = fit([P.hex(c, 2)], bw - 1, 9);
      label(glyph(c), bx + bw / 2, y + h * 0.36, tc, 13, 'center', 600);
      if (hx) label(hx, bx + bw / 2, y + h * 0.74, tc, 9, 'center');
    }
  }
  function dash(x0, y0, x1, y1) {
    ctx.strokeStyle = th.muted; ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
  }
  function drawB257(W) {
    var sl = P.slot257(cur.s), start = 32 * sl.block, k = step, h = hot();
    var x0 = 76, H2 = 26, H1 = 16, rh = 44, yT = 62, yB = 196, xR = W - 16;
    var dw = (xR - x0 - 4 * H2) / 4, bw = H2 + dw;
    function dx(g) { return x0 + g * bw + H2; }     // where d_g starts in tx_coded_g
    var xB = xR - H1 - 4 * dw;                      // tx_xcoded is packed and ends with tx_coded_3
    function bx(g) { return xB + H1 + g * dw; }     // where d_g starts in tx_xcoded
    label('in', 8, yT + rh / 2 - 7, th.ink, 11, 'left', 700);
    label('4 × 66 bits', 8, yT + rh / 2 + 8, th.muted, 9);
    label('out', 8, yB + rh / 2 - 7, th.ink, 11, 'left', 700);
    label('257 bits', 8, yB + rh / 2 + 8, th.muted, 9);
    for (var g = 0; g < 4; g++) {
      var xb = x0 + g * bw, xd = dx(g), placed = k >= g + 2, src = start + 8 * g;
      label('tx_coded_' + g, xb + bw / 2, yT - 36, th.ink, 11, 'center', 600);
      label('66-bit block ' + (4 * sl.block + g), xb + bw / 2, yT - 22, th.muted, 9, 'center');
      label('0', xb + 2, yT - 8, th.muted, 9);
      label('2', xd + 2, yT - 8, th.muted, 9);
      label('65', xb + bw - 2, yT - 8, th.muted, 9, 'right');
      hdrTile(xb, yT, H2, rh, '01', '', false);
      payload(xd, yT, dw, rh, src, false, placed && stepping);
      box(xb, yT, bw, rh, null, th.ink);
      // Output: d_g unchanged, packed right after d_(g-1).
      var xo = bx(g);
      payload(xo, yB, dw, rh, src, !placed, false);
      if (placed && g > 0) { ctx.fillStyle = th.ink; ctx.fillRect(xo - 0.75, yB, 1.5, rh); }
      label('d_' + g, (xd + xo) / 2 + dw / 2, (yT + rh + yB) / 2, placed ? th.ink : th.muted, 11, 'center', 600);
      // Both edges of a 01 header meet at one boundary below: its 2 bits are gone.
      if (k >= 1 && g === 0) dash(xd, yT + rh, xo, yB);
      if (placed && g > 0) { dash(xb, yT + rh, xo, yB); dash(xd, yT + rh, xo, yB); }
      if (placed && g === 3) dash(xR, yT + rh, xR, yB);
      if (h === 0) box(xb - 1, yT - 1, H2 + 2, rh + 2, null, th.am, 2);
      if (h === g + 1) { box(xd - 1, yT - 1, dw + 2, rh + 2, null, th.ink, 2); box(xo - 1, yB - 1, dw + 2, rh + 2, null, th.ink, 2); }
    }
    hdrTile(xB, yB, H1, rh, '1', '', k < 1);
    box(xB, yB, xR - xB, rh, null, th.ink);
    if (h === 0) box(xB - 1, yB - 1, H1 + 2, rh + 2, null, th.am, 3);
    label('0', xB + 2, yB + rh + 10, th.muted, 9);
    label('256', xR - 2, yB + rh + 10, th.muted, 9, 'right');
    label('tx_xcoded · 257-bit block ' + sl.block, (xB + xR) / 2, yB + rh + 14, th.ink, 11, 'center', 600);
    var yc = yB + rh + 42;
    label('all four blocks are data (01), so the four sync headers become one header bit 1', x0, yc, th.ink, 10, 'left', 600);
    label('d_0…d_3 are copied unchanged: 4 × 66 = 264 bits in, 1 + 4 × 64 = 257 bits out', x0, yc + 18, th.muted, 10);
  }

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
  function symTile(x, y, w, q, j, name, fade, bare) {
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
    // A bare tile keeps only the run dividers.
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
      if (txt && !bare) label(txt, x + (n0 + n1) / 2 * cw, y + 47, th.ink2, 11, 'center', 600);
      if (n0 > 0) box(x + n0 * cw - 0.5, y + 17, 1.5, 20, th.paper);
      n0 = n1;
    }
    ctx.globalAlpha = 1;
  }
  /* ---- pre-FEC distribution, page 0: the overview. The input stream is a thin
     bar like the RS to-scale bars, its first PF_CON 10-bit symbols marked off by
     faint dashed lines; m_A and m_B are thin vertical bars below. Stepping deals
     one symbol at a time: even symbols down to m_A, odd ones to m_B. ---- */
  var PF_CON = 56, PF_ROWS = PF_CON / 2;   // symbols shown, and rows of each message bar
  var PF_CONCEPT = { title: 'Pre-FEC distribution · Overview', steps: PF_CON, rate: 6, h: 432,
    nav: function (c, d) { return { q: c.q + d, j: c.j }; },
    where: function (c) { return 'Pair ' + c.q + ': 40 × 257 = 10,280 bits → 1028 ten-bit symbols → m_A and m_B, 514 symbols each'; } };
  function pfDash(x0, y0, x1, y1) {
    ctx.strokeStyle = th.paper; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  function drawPrefecConcept(W) {
    var q = cur.q, k = step, h = hot();
    var x0 = 96, xE = W - 60, sw = (xE - x0) / PF_CON, y0 = 52, bh = 12;
    var vw = 12, ch = 8, yOut = 140, hOut = PF_ROWS * ch;
    var xs = [Math.round(x0 + (xE - x0) * 0.3), Math.round(x0 + (xE - x0) * 0.7)];
    function cell(j) { return { x: xs[j & 1], y: yOut + (j >> 1) * ch }; }
    label('in: tx_scrambled_am, 40 × 257-bit blocks = 10,280 bits = 1028 ten-bit symbols, bit 0 first →', x0, 18, th.ink, 11, 'left', 600);
    label('stream', 8, y0 + bh / 2, th.ink, 11, 'left', 700);
    // The stream bar, each symbol in the colour of the message it goes to; dealt symbols fade while stepping.
    for (var j = 0; j < PF_CON; j++) {
      if (stepping && k > j) ctx.globalAlpha = 0.28;
      box(x0 + j * sw, y0, sw + 0.5, bh, j & 1 ? th.b : th.a);
      ctx.globalAlpha = 1;
    }
    for (var d = 1; d < PF_CON; d++) pfDash(x0 + d * sw, y0, x0 + d * sw, y0 + bh);
    label('⋯ s1027', xE + 6, y0 + bh / 2, th.muted, 10);
    for (var n = 0; n < PF_CON; n += 8) label('s' + n, x0 + (n + 0.5) * sw, y0 - 9, th.muted, 9, 'center');
    // 257-bit block boundaries fall inside symbols: blocks and symbols do not line up.
    for (var b = 0; 257 * b < 10 * PF_CON; b++) {
      var bx = x0 + 25.7 * b * sw;
      if (b) { ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx, y0 - 2); ctx.lineTo(bx, y0 + bh + 6); ctx.stroke(); }
      label('257-bit block ' + (P.slot257(q * P.PAIR_SLOTS + b).am ? b + ' (AM)' : b), bx + 4, y0 + bh + 12, th.muted, 9);
    }
    // The two messages: thin vertical bars, one symbol per dashed row.
    [0, 1].forEach(function (w) {
      var x = xs[w], c = w ? th.b : th.a;
      label('m_' + cwName(w) + ' · 514 symbols', x + vw / 2, yOut - 14, th.ink, 11, 'center', 700);
      box(x, yOut, vw, hOut, null, th.rule);
      for (var r = 0; r < PF_ROWS; r++) {
        var jj = 2 * r + w;
        if (!stepping || k > jj) box(x, yOut + r * ch, vw, ch + 0.5, c);
        if (r % 4 === 0) label(cwName(w) + r, x + vw + 6, yOut + r * ch + ch / 2, th.muted, 9);
      }
      for (var r2 = 1; r2 < PF_ROWS; r2++) pfDash(x, yOut + r2 * ch, x + vw, yOut + r2 * ch);
      label('⋮ ' + cwName(w) + '513', x + vw / 2, yOut + hOut + 12, th.muted, 10, 'center');
    });
    // The route of the symbol just dealt, while stepping.
    function route(j, col, lw) {
      var cx = x0 + (j + 0.5) * sw, t = cell(j), ty = t.y + ch / 2, side = t.x < cx ? t.x + vw + 2 : t.x - 2;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(cx, y0 + bh + 2);
      ctx.bezierCurveTo(cx, ty, (cx + side) / 2, ty, side, ty); ctx.stroke();
      var dir = t.x < cx ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(side, ty); ctx.lineTo(side + 7 * dir, ty - 4); ctx.lineTo(side + 7 * dir, ty + 4); ctx.closePath(); ctx.fill();
    }
    if (h >= 0) {
      route(h, th.ink, 1.6);
      box(x0 + h * sw - 1, y0 - 2, sw + 2, bh + 4, null, th.ink, 2);
      var t = cell(h); box(t.x - 2, t.y - 2, vw + 4, ch + 4, null, th.ink, 2);
    }
    var yc = yOut + hOut + 36;
    label('stream symbol 2i → m_A as A_i, symbol 2i+1 → m_B as B_i, 10 bits each, unchanged (119.2.4.5)', x0, yc, th.ink, 10, 'left', 600);
    label('dashed lines = 10-bit symbol boundaries; solid ticks = 257-bit blocks (mid-symbol); colour = destination', x0, yc + 18, th.muted, 10);
  }


  /* ---- pre-FEC distribution, page 1: detailed bits view with actual 10-bit tiles.
     Stream horizontal at top, m_A and m_B below. ---- */
  function drawPrefec(W) {
    var q = cur.q, j0 = cur.j, k = step, h = hot(), N = PF_SYMS;
    var x0 = 70, sw = (W - 16 - x0) / N, th1 = 52, oh = 37;
    var yLoc = 12, yS = 54, yA = 160, yB = 236;
    // Where this window sits in the pair's 1028 symbols: the overview bar, shrunk.
    var lx0 = x0 + 22, lw = W - 16 - 44 - lx0;
    box(lx0, yLoc - 2, lw, 4, mix(th.edge, th.paper, 0.55));
    box(lx0 + j0 * lw / 1028, yLoc - 5, Math.max(3, N * lw / 1028), 10, th.ink);
    label('s0', lx0 - 4, yLoc, th.muted, 9, 'right');
    label('s1027', lx0 + lw + 4, yLoc, th.muted, 9);
    label('in: tx_scrambled_am, 10 bits per symbol, bit 0 first →', x0, 34, th.ink, 11, 'left', 600);
    label('stream', 8, yS + 27, th.ink, 11, 'left', 700);
    label('m_A', 8, yA + 18, th.ink, 11, 'left', 700);
    label('even s', 8, yA + 32, th.muted, 9);
    label('m_B', 8, yB + 18, th.ink, 11, 'left', 700);
    label('odd s', 8, yB + 32, th.muted, 9);
    // Byte index of stream bit b, or -1 when it is not a payload byte.
    function byteOf(b) { var s = P.pairBit(q, b); return s.src === 'b' ? s.idx : -1; }
    for (var t = 0; t < N; t++) {
      var j = j0 + t, i = j >> 1, odd = j & 1, x = x0 + t * sw, yd = odd ? yB : yA, cx = x + sw / 2;
      var done = k > t, on = t === h;
      // The stream is one strip: tiles touch, a faint dash marks each symbol boundary.
      symTile(x, yS, sw, q, j, 's' + j, done && stepping);
      if (t) pfDash(x, yS, x, yS + 37);
      label(fit(['bits ' + 10 * j + '–' + (10 * j + 9), String(10 * j)], sw, 9), cx, yS + th1 + 14, th.muted, 9, 'center');
      // A character cut by this boundary: a bracket under its bits on both sides.
      var c = byteOf(10 * j + 9);
      if (t < N - 1 && c >= 0 && byteOf(10 * j + 10) === c) {
        var n0 = 9; while (n0 > 0 && byteOf(10 * j + n0 - 1) === c) n0--;
        var n1 = 10; while (n1 < 19 && byteOf(10 * j + n1 + 1) === c) n1++;
        var bx0 = x + n0 * sw / 10 + 1, bx1 = x + (n1 + 1) * sw / 10 - 1, by = yS + th1 + 2;
        ctx.strokeStyle = th.ink2; ctx.lineWidth = 1.2; ctx.beginPath();
        ctx.moveTo(bx0, by - 3); ctx.lineTo(bx0, by); ctx.lineTo(bx1, by); ctx.lineTo(bx1, by - 3); ctx.stroke();
      }
      // The drop, straight down: faint once dealt, bold for the symbol being dealt now.
      if (done) {
        ctx.strokeStyle = on ? th.ink : mix(odd ? th.b : th.a, th.paper, 0.3); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = on ? 1.6 : 1;
        ctx.beginPath(); ctx.moveTo(cx, yS + th1 + 22); ctx.lineTo(cx, yd - 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, yd - 1); ctx.lineTo(cx - 4, yd - 8); ctx.lineTo(cx + 4, yd - 8); ctx.closePath(); ctx.fill();
      }
      // Output tile: name, hex and bits; the characters are already read off the stream above.
      if (done) symTile(x, yd, sw, q, j, (odd ? 'B' : 'A') + i, false, true);
      else box(x, yd, sw, oh, null, th.rule);
      if (on) { box(x - 2, yS - 2, sw + 4, 41, null, th.ink, 2); box(x - 2, yd - 2, sw + 4, oh + 4, null, th.ink, 2); }
    }
    var yc = yB + oh + 26;
    label('A_i = stream symbol 2i, B_i = symbol 2i+1, 10 bits each, unchanged (119.2.4.5)', x0, yc, th.ink, 10, 'left', 600);
    label('bracket = a character split between A and B' + (P.isAmPair(q) && j0 < 102 ? ' · lane colours = AM bits' : '') +
      ' · dark bit = 257-bit block header', x0, yc + 16, th.muted, 10);
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
    // Length to scale: two messages in, two codewords out, 30 parity symbols appended to each.
    var yb = y0 + 2 * th1 + 64, bw = W - 16 - x0, barH = 12, gap = 4;
    var hw = (bw - gap) / 2, pm = hw * 514 / 544;
    label('in', 8, yb + barH / 2, th.ink, 11, 'left', 600);
    label('out', 8, yb + barH + gap + barH / 2, th.ink, 11, 'left', 600);
    [0, 1].forEach(function (w) {
      var bx = x0 + w * (hw + gap), c = w ? th.b : th.a;
      label('m_' + cwName(w), bx + hw / 2, yb - 11, c, 9, 'center', 600);
      // in: 514 message symbols
      box(bx, yb, pm, barH, c);
      box(bx + pm, yb, hw - pm, barH, null, th.rule);
      // out: 514 message symbols (unchanged) + up to 30 parity (animated)
      box(bx, yb + barH + gap, pm, barH, c);
      box(bx + pm, yb + barH + gap, (hw - pm) * Math.min(1, k / 30), barH, th.ink);
      box(bx + pm, yb + barH + gap, hw - pm, barH, null, th.rule);
    });
    label('to scale: 514 message symbols in each codeword pass through unchanged; only the 30 parity symbols are new', x0, yb + 2 * barH + gap + 16, th.ink, 10, 'left', 600);
    label((P.isAmPair(q) ? 'amber = symbols holding the AM group; ' : '') + 'dark = parity, hex values shown', x0, yb + 2 * barH + gap + 34, th.muted, 10);
    label('parity = remainder of m(x)·x³⁰ ÷ g(x), g(x) = (x−α⁰)(x−α¹)…(x−α²⁹) over GF(2¹⁰) (Clause 91)', x0, yb + 84, th.muted, 10);
  }

  /* ---- symbol distribution: overview page 0 ---- */
  var DIST_CON = 136;   // animation steps: all 136 lane symbols of a pair
  var DIST_CONCEPT = { title: 'Symbol distribution · Overview', steps: DIST_CON, rate: 16, h: 390,
    nav: function (c, d) { return { q: c.q + d, u: 0 }; },
    where: function (c) {
      return 'Pair ' + c.q + ': codewords A and B → 136 symbols per PCS lane' + (P.isAmPair(c.q) ? ' (first 12 = alignment marker)' : '');
    } };
  function drawDistConcept(W) {
    var q = cur.q, k = step, h = hot();
    var am = P.isAmPair(q);
    // Layout: two thin input bars, then 8 vertical lane bars spread across the full width.
    var x0 = 96, xE = W - 16, bw = xE - x0, barH = 12, barGap = 6;
    var yA = 42, yB = yA + barH + barGap;       // input bars
    var laneH = 200, yLane = yB + barH + 58;     // lane bars start
    // Spread 8 lane bars evenly across bw with equal inter-bar gaps.
    var laneW = Math.round((bw - 7 * 4) / 8);   // ~4px gap between lanes
    var laneStep = laneW + Math.round((bw - 8 * laneW) / 7);
    // Lane bar centre x.
    function laneCx(p) { return x0 + p * laneStep + laneW / 2; }

    // Row labels on the left.
    label('in', 8, (yA + yB + barH) / 2, th.ink, 11, 'left', 700);
    label('out', 8, yLane + laneH / 2, th.ink, 11, 'left', 700);

    // Column labels: A over left half, B over right half of each bar.
    label('codeword A · 544 symbols', x0, yA - 11, th.a, 9, 'left', 600);
    label('codeword B · 544 symbols', x0, yB + barH + 11, th.b, 9, 'left', 600);

    // Input bars.
    box(x0, yA, bw, barH, th.a);
    box(x0, yB, bw, barH, th.b);
    // AM region: first 96 tx_out symbols. Each goes to A or B depending on laneSymbolId.
    if (am) {
      for (var s = 0; s < 96; s++) {
        var id2 = P.laneSymbolId(s % 8, Math.floor(s / 8));
        var sx2 = x0 + s * bw / 544, sw2 = bw / 544 + 0.5;
        box(sx2, id2.w ? yB : yA, sw2, barH, th.lanes[s % 8]);
      }
    }
    // Faint symbol boundaries.
    ctx.strokeStyle = th.paper; ctx.globalAlpha = 0.25; ctx.lineWidth = 0.5; ctx.setLineDash([1, 2]);
    for (var si = 1; si < 544; si++) {
      var bxi = x0 + si * bw / 544;
      ctx.beginPath(); ctx.moveTo(bxi, yA); ctx.lineTo(bxi, yA + barH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bxi, yB); ctx.lineTo(bxi, yB + barH); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // Parity boundary tick.
    var parX = x0 + 514 * bw / 544;
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(parX, yA - 3); ctx.lineTo(parX, yB + barH + 3); ctx.stroke();
    label('514', parX, yA - 5, th.muted, 8, 'center');
    label('+30', parX + (xE - parX) / 2, yA - 5, th.muted, 8, 'center');

    // 8 vertical lane bars.
    for (var p = 0; p < 8; p++) {
      var lx = x0 + p * laneStep, lc = th.lanes[p];
      // Swatch and label above the bar.
      box(lx + Math.round(laneW / 2) - 4, yLane - 20, 8, 6, lc);
      label('PCS ' + p, lx + laneW / 2, yLane - 7, th.ink, 8, 'center');
      // Ghost outline.
      box(lx, yLane, laneW, laneH, null, th.rule);
      // Fill: how many symbols has lane p received so far?
      var nFilled = k > p ? Math.ceil((k - p) / 8) : 0;
      if (nFilled > 0) {
        var fillH = Math.round(nFilled * laneH / 136);
        var amH = am ? Math.round(Math.min(nFilled, 12) * laneH / 136) : 0;
        if (amH > 0) box(lx, yLane, laneW, amH, mix(lc, th.am, 0.5));
        if (fillH - amH > 0) box(lx, yLane + amH, laneW, fillH - amH, lc);
      }
      // Faint symbol dividers.
      ctx.strokeStyle = th.paper; ctx.globalAlpha = 0.2; ctx.lineWidth = 0.5; ctx.setLineDash([1, 2]);
      for (var ri = 1; ri < 136; ri++) {
        var riy = yLane + ri * laneH / 136;
        ctx.beginPath(); ctx.moveTo(lx, riy); ctx.lineTo(lx + laneW, riy); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      label('136', lx + laneW / 2, yLane + laneH + 11, th.muted, 8, 'center');
    }

    // Bezier routes: from source position on A or B bar to destination lane bar.
    function drawRoute(s, alpha, lw2) {
      var id3 = P.laneSymbolId(s % 8, Math.floor(s / 8));
      var srcY = id3.w ? yB + barH : yA + barH;
      var srcX = x0 + (s + 0.5) * bw / 544;
      var dstX = laneCx(s % 8);
      var ny2 = Math.floor(s / 8);
      var dstY = yLane + (ny2 + 0.5) * laneH / 136;
      var midY = srcY + (dstY - srcY) * 0.5;
      ctx.strokeStyle = th.lanes[s % 8]; ctx.lineWidth = lw2; ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.moveTo(srcX, srcY);
      ctx.bezierCurveTo(srcX, midY, dstX, midY, dstX, dstY);
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // Ghost routes: show every 8th symbol (covers all 8 lanes once per group) up to
    // how far the animation has reached.
    var ghostMax = stepping ? k : DIST_CON;
    for (var sc = 0; sc < ghostMax; sc += 8) { drawRoute(sc, 0.18, 1); }
    // Active route.
    if (h >= 0) {
      drawRoute(h, 1, 2);
      // Highlight the source tile.
      var hid3 = P.laneSymbolId(h % 8, Math.floor(h / 8));
      var hx = x0 + (h + 0.5) * bw / 544 - 4;
      box(hx, hid3.w ? yB - 2 : yA - 2, 8, barH + 4, null, th.ink, 2);
    }

    var yc = yLane + laneH + 24;
    label('tx_out symbol s → PCS lane s mod 8; lane p gets A or B alternately, 136 symbols per lane per pair (119.2.4.8)', x0, yc, th.ink, 10, 'left', 600);
    label((am ? 'first 12 symbols = alignment marker for that lane (shown mixed amber) · ' : '') +
      'parity starts at symbol 514', x0, yc + 16, th.muted, 10);
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
  /* ---- AM insertion. On top, Figure 119-6 as a progress bar of three
     81,920-block periods: the second half of chunk 0, then chunks 1 and 2,
     each opened by its 4 AM blocks. Step / Animate fill it in arrival order.
     Below, chunk 1's group falling into the 4-block gap rate matching left. ---- */
  var AM_DATA = 20, AM_HALF = AM_DATA / 2, AM_CHUNK = P.AM_SLOTS + AM_DATA;   // steps per chunk
  var AM_STEPS = AM_HALF + 2 * AM_CHUNK;
  VIEWS.am.steps = AM_STEPS;
  // Blocks of chunk c (0..2) that have arrived after step k.
  function amFill(c, k) {
    if (c === 0) return Math.round(AM_STD * (AM_HALF + Math.min(AM_HALF, k)) / AM_DATA);
    var t = k - AM_HALF - (c - 1) * AM_CHUNK;
    if (t <= 0) return 0;
    if (t <= P.AM_SLOTS) return t;
    return P.AM_SLOTS + Math.round((AM_STD - P.AM_SLOTS) * Math.min(AM_DATA, t - P.AM_SLOTS) / AM_DATA);
  }
  function amLive(k) {
    if (k <= AM_HALF) return 0;
    return k <= AM_HALF + AM_CHUNK ? 1 : 2;
  }
  function amStatus(k) {
    var c = amLive(k), n = amFill(c, k);
    if (c === 0) return 'chunk 0: 257-bit data blocks arriving, ' + num(n) + ' of ' + num(AM_STD);
    if (n <= P.AM_SLOTS) return 'chunk ' + (c - 1) + ' is full. Chunk ' + c + ' starts with AM block ' + n + ' of 4';
    if (n < AM_STD) return 'chunk ' + c + ': AM group in, data blocks arriving, ' + num(n - P.AM_SLOTS) + ' of ' + num(AM_STD - P.AM_SLOTS);
    return 'chunk ' + c + ' is full: ' + num(AM_STD) + ' blocks. The next chunk starts with its own 4 AM blocks';
  }
  // Step of the close-up below, driven by chunk 1: AM blocks one at a time,
  // then its first 36 data blocks with the first data step.
  function amDetail(k) {
    var n = amFill(1, k);
    return n <= P.AM_SLOTS ? n : Math.min(2 * P.PAIR_SLOTS, P.AM_SLOTS + Math.round((n - P.AM_SLOTS) * AM_DATA * (P.PAIR_SLOTS - P.AM_SLOTS) / (AM_STD - P.AM_SLOTS)));
  }
  function amPeriod(W, k) {
    var x0 = 70, xR = W - 16, y = 44, h = 22, gap = 6, live = amLive(k);
    var cw = (xR - x0 - 2 * gap) / 2.5, aw = Math.max(40, Math.min(56, cw * 0.14));
    var xs = [x0, x0 + cw / 2 + gap, x0 + 1.5 * cw + 2 * gap], ws = [cw / 2, cw, cw];
    var full = mix(th.edge, th.paper, 0.15), empty = mix(th.edge, th.paper, 0.85), amEmpty = mix(th.am, th.paper, 0.75);
    label('802.3 Figure 119–6: 4 AM blocks inserted every ' + num(AM_STD) + ' × 257-bit blocks', x0, 12, th.ink, 11, 'left', 600);
    for (var c = 0; c < 3; c++) {
      var x = xs[c], w = ws[c], n = amFill(c, k), a = c ? aw : 0, dx = x + a, dw = w - a, head = x;
      // Chunk 0 shows only its second half; the first half has already passed.
      var d = c ? Math.max(0, n - P.AM_SLOTS) : n - AM_STD / 2, dmax = c ? AM_STD - P.AM_SLOTS : AM_STD / 2;
      box(dx + 1, y, dw - 1, h, empty);
      if (d > 0) { box(dx + 1, y, (dw - 1) * d / dmax, h, full); head = dx + 1 + (dw - 1) * d / dmax; }
      if (c) {
        var sw = a / P.AM_SLOTS;
        for (var s = 0; s < P.AM_SLOTS; s++) box(x + s * sw, y, sw - 1, h, s < n ? th.am : amEmpty);
        if (n > 0 && n <= P.AM_SLOTS) head = x + n * sw;
        if (aw >= 40) label('AM', x + a / 2, y + h / 2, onFill(th.am), 9, 'center', 700);
      } else {
        label('ooo', x + 14, y + h / 2, onFill(full), 9, 'center');
      }
      if (c === 1) box(x - 2, y - 2, a + 3, h + 4, null, th.ink, 1.5);   // the group shown close up below
      var on = c === live && stepping && step < AM_STEPS;
      if (on) {
        ctx.fillStyle = th.ink; ctx.beginPath();
        ctx.moveTo(head, y + h + 2); ctx.lineTo(head - 5, y + h + 9); ctx.lineTo(head + 5, y + h + 9); ctx.closePath(); ctx.fill();
      }
      var name = c ? 'chunk ' + c : 'chunk 0 (second half)';
      label(fit([name + '  ' + num(n) + ' / ' + num(AM_STD), name], w, 10, 600), x, y - 10, c === live ? th.ink : th.muted, 10, 'left', c === live ? 700 : 500);
      if (!c) continue;
      // Dimension line under each full period.
      var yd = y + h + 18;
      ctx.strokeStyle = th.muted; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(x + 0.5, yd - 4); ctx.lineTo(x + 0.5, yd + 4);
      ctx.moveTo(x + w - 0.5, yd - 4); ctx.lineTo(x + w - 0.5, yd + 4);
      ctx.moveTo(x, yd); ctx.lineTo(x + w, yd); ctx.stroke();
      var txt = fit(['4 AM + ' + num(AM_STD - P.AM_SLOTS) + ' data = ' + num(AM_STD) + ' blocks', num(AM_STD) + ' blocks'], w - 16, 10);
      ctx.font = font(10); var tw = ctx.measureText(txt).width + 10;
      box(x + w / 2 - tw / 2, yd - 7, tw, 14, th.paper);
      label(txt, x + w / 2, yd, th.muted, 10, 'center');
    }
    label(amStatus(k), x0, y + h + 40, th.ink, 11, 'left', 600);
    label('below: chunk 1’s AM insertion (outlined) close up. The lab’s 3D view repeats every ' + AM_LAB + ' blocks so markers stay on screen.', x0, y + h + 58, th.muted, 10);
  }

  // Tile layout of the AM close-up, shared by drawing and click hit-testing.
  // Each side is two rows of 40: slots 0-39, then the 40 regular blocks of slots 40-79.
  function amGeo(W) {
    var x0 = 70, hh = 34, y1 = 160, y2 = 300;
    return { x0: x0, sw: (W - x0 - 16) / 40, hh: hh, rows: [[y1, y1 + hh + 20], [y2, y2 + hh + 8]] };
  }
  // Slot (0-79) under canvas point (x, y), or -1.
  function amHit(x, y) {
    var g = amGeo(cv.width / dpr), s = Math.floor((x - g.x0) / g.sw);
    if (s < 0 || s >= 40) return -1;
    for (var side = 0; side < 2; side++) for (var r = 0; r < 2; r++) {
      var ty = g.rows[side][r];
      if (y >= ty && y < ty + g.hh) return 40 * r + s;
    }
    return -1;
  }
  // 257-bit block in slot s (0-79) of the close-up, or null for an AM slot.
  function amSlotBlock(s) {
    var first = P.slot257(cur.q * P.PAIR_SLOTS + P.AM_SLOTS).block;
    if (s < P.AM_SLOTS) return null;
    return first + s - P.AM_SLOTS;
  }

  function drawAm(W) {
    amPeriod(W, step);
    var q = cur.q, g = amGeo(W), x0 = g.x0, sw = g.sw, hh = g.hh, k = amDetail(step);
    var y1 = g.rows[0][0], y1n = g.rows[0][1], y2 = g.rows[1][0], y2n = g.rows[1][1];
    var b0 = amSlotBlock(P.PAIR_SLOTS);
    label('before', 8, y1 + hh / 2, th.muted, 11);
    label('after', 8, y2 + hh / 2, th.muted, 11);
    function tile(x, y, b) { box(x + 1, y, sw - 2, hh, th.edge); if (sw > 18) label(String(b), x + sw / 2, y + hh / 2, th.paper, 9, 'center'); }
    // Slot numbers only under the before rows; the number inside a tile is the 257-bit block.
    [y1, y1n].forEach(function (y, r) {
      label('slot', 8, y + hh + 9, th.muted, 9);
      if (sw > 12) for (var s = 0; s < 40; s++) label(String(40 * r + s), x0 + s * sw + sw / 2, y + hh + 9, th.muted, 9, 'center');
    });
    for (var i = 0; i < 40; i++) {
      var xi = x0 + i * sw;
      tile(xi, y1n, b0 + i);
      if (40 + i < k) tile(xi, y2n, b0 + i); else box(xi + 1, y2n, sw - 2, hh, null, th.rule);
    }
    for (var s = 0; s < 40; s++) {
      var x = x0 + s * sw, sl = P.slot257(q * 40 + s);
      if (sl.am) box(x + 1, y1, sw - 2, hh, null, th.rule);
      else tile(x, y1, sl.block);
      if (sl.am) continue;
      if (s < k) tile(x, y2, sl.block); else box(x + 1, y2, sw - 2, hh, null, th.rule);
    }
    // The AM group falls from the gap in the before row into the after row.
    for (var a = 0; a < P.AM_SLOTS; a++) if (a >= k) box(x0 + a * sw + 1, y2, sw - 2, hh, null, th.rule);
    if (k > 0) {
      var fall = Math.min(1, k / 4), gy = y1 + (y2 - y1) * fall, bw = (4 * sw - 2) / 103;
      for (var n = 0; n < 96; n++) {
        var t = n >> 3, r = n & 7, j = r >> 1, lane = (t % 2 === 0) === ((r & 1) === 0) ? 2 * j : 2 * j + 1;
        box(x0 + 1 + n * bw, gy, bw + 0.3, hh, th.lanes[lane]);
      }
      box(x0 + 1 + 96 * bw, gy, 7 * bw, hh, th.am);
      label('am_mapped<1027:0>', x0 + 2 * sw, gy - 9, th.ink, 10, 'center', 600);
    }
    label('rate matching has left 4 block slots (1028 bits) empty', x0, y1 - 12, th.muted, 10);
    label('4 AM blocks (1028 bits), then the 257-bit blocks resume', x0, y2n + hh + 22, th.ink, 11, 'left', 600);
    label('slots 40–79: 40 regular 257-bit blocks, no AM until 81,920 blocks after this group', x0, y2n + hh + 40, th.muted, 10);
    label('colours = which lane’s marker each 10 bits belong to · number in a tile = 257-bit block · click a slot to see its bits', x0, y2n + hh + 56, th.muted, 10);
    // The picked slot, outlined in both the before and after rows.
    if (pick >= 0) {
      var px = x0 + (pick % 40) * sw, r = pick < 40 ? 0 : 1;
      [g.rows[0][r], g.rows[1][r]].forEach(function (y) { box(px - 1, y - 2, sw + 2, hh + 4, null, th.ink, 2); });
    }
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

  var DRAW = { b66: drawB66, b257: drawB257, am: drawAm,
    prefec: function (W) { (pfPage ? drawPrefec : drawPrefecConcept)(W); },
    rs: drawRs,
    dist: function (W) { (distPage ? drawDist : drawDistConcept)(W); },
    mux: drawMux };
  // The view in force: pre-FEC and dist each have an overview page with their own steps and size.
  function view() {
    if (mode === 'prefec' && !pfPage) return PF_CONCEPT;
    if (mode === 'dist' && !distPage) return DIST_CONCEPT;
    return VIEWS[mode];
  }
  function height() { return mode === 'mux' ? 152 + 22 * S.link.k : view().h; }

  // Page arrows for views that have two pages.
  function pageArrows() {
    ['opv-pg-l', 'opv-pg-r'].forEach(function (id) {
      var b = $(id);
      if (!b) return;
      var show = mode === 'prefec' || mode === 'dist';
      b.hidden = !show;
      var onPage1 = mode === 'prefec' ? pfPage : distPage;
      var t = onPage1 ? 'Back to the overview' : 'Show distribution details';
      b.title = t; b.setAttribute('aria-label', t);
    });
  }
  function size() {
    if (!cv || !mode) return;
    pageArrows();
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
    var v = view(), N = v.steps;
    if (mode === 'prefec' || mode === 'dist') $('opv-title').textContent = v.title;
    var pageSuffix = '';
    if (mode === 'prefec') pageSuffix = ' · page ' + (pfPage ? '2: Distribution details' : '1: Overview');
    if (mode === 'dist') pageSuffix = ' · page ' + (distPage ? '2: Detail' : '1: Overview');
    $('opv-where').textContent = v.where(cur) + pageSuffix;
    $('opv-prev').hidden = $('opv-next').hidden = !v.nav;
    $('opv-play').textContent = anim ? 'Pause' : step < N ? 'Play' : 'Animate';
    $('opv-count').textContent = stepping ? Math.min(step, N) + ' / ' + N : '';
    cv.setAttribute('aria-label', v.title + '. ' + v.where(cur) + '.');
    pickPanel();
    dirty = true; draw();
  }

  /* ---- AM view: what AM insertion does to one clicked slot ---- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // am_mapped<hi:lo>, bit 0 first: one coloured run per 10 bits of a lane's marker, then pad and status.
  function amBits(lo, hi) {
    var h = '', run = '', key = null, tip = '';
    function flush() { if (run) h += '<span class="' + key + '" title="' + tip + '">' + run + '</span>'; run = ''; }
    for (var b = lo; b <= hi; b++) {
      var t = P.pairBit(cur.q, b), k = t.src === 'am' ? 'l' + t.lane : t.src;
      if (k !== key || (t.src === 'am' && b % 10 === 0)) {
        flush(); key = k;
        tip = t.src === 'am' ? 'am_' + t.lane + ' bits ' + t.n + '–' + (t.n + 9 - t.n % 10) : t.src === 'pad' ? '65-bit pad' : '3-bit status field';
      }
      run += t.v;
    }
    flush();
    return h;
  }
  function amSummary(lo, hi) {
    var m = 0, p = 0, f = 0;
    for (var b = lo; b <= hi; b++) { var s = P.pairBit(cur.q, b).src; if (s === 'am') m++; else if (s === 'pad') p++; else f++; }
    return 'These 257 bits are am_mapped<' + hi + ':' + lo + '>: ' + m + ' bits of the 8 lane markers' + (p ? ', the ' + p + '-bit pad' : '') + (f ? ' and the ' + f + '-bit status field' : '') + '. ' +
      'Each coloured run is 10 bits of one lane’s marker (hover for which bits); after pre-FEC and symbol distribution every PCS lane gets back its own 120-bit marker.' +
      (p ? ' The lab’s pad pattern stands in for PRBS9.' : '');
  }
  function blockText(b) { var h = ''; for (var i = 0; i < 32; i++) h += esc(glyph(P.byteAt(32 * b + i))); return h; }
  function blockCells(b) {
    var h = '<div class="cells"><span class="cell hdr"><b>1</b><i>hdr</i></span>';
    for (var i = 0; i < 32; i++) {
      var c = P.byteAt(32 * b + i);
      h += '<span class="cell' + (c === 32 ? ' sp' : '') + '"><b>' + (c === 32 ? '&nbsp;' : esc(P.glyph(c))) + '</b><i>' + P.hex(c, 2) + '</i></span>';
    }
    return h + '</div>';
  }
  var pickKey = null;
  function pickPanel() {
    var el = $('opv-pick');
    if (!el) return;
    el.hidden = mode !== 'am';
    var key = mode === 'am' ? pick + ':' + cur.q + ':' + P.payloadVersion : null;
    if (key === pickKey) return;
    pickKey = key;
    if (mode !== 'am') { el.innerHTML = ''; return; }
    if (pick < 0) {
      el.innerHTML = '<div class="pk-head"><span class="note">Click a slot in the rows above to see its 257 bits before and after AM insertion.</span>' +
        '<button type="button" class="btn" data-act="pk-next">Show slot 0</button></div>';
      return;
    }
    var s = pick, b = amSlotBlock(s), next = s >= P.PAIR_SLOTS, h;
    h = '<div class="pk-head"><button type="button" class="btn" data-act="pk-prev" aria-label="Previous slot">‹</button><b>Slot ' + s + ': ' +
      (b === null ? 'AM block ' + (s + 1) + ' of 4' : '257-bit block ' + b) + '</b><button type="button" class="btn" data-act="pk-next" aria-label="Next slot">›</button>' +
      '<span class="opv-sp"></span><button type="button" class="btn" data-act="pk-clear">Clear</button></div>';
    var before, after, foot;
    if (b === null) {
      var lo = 257 * s, hi = lo + 256;
      before = '<div class="pk-empty">Empty. Rate matching deleted idles here, so no data block has to move to make room.</div>';
      after = '<p class="pk-eq">tx_scrambled_am&lt;' + hi + ':' + lo + '&gt; = am_mapped&lt;' + hi + ':' + lo + '&gt;</p><div class="ambits" title="bit 0 first">' + amBits(lo, hi) + '</div>';
      foot = '<p class="note">' + esc(amSummary(lo, hi)) + '</p>';
    } else {
      // tx_scrambled_i is counted within one 10,280-bit block (119.2.4.4.1).
      var i = next ? s - P.PAIR_SLOTS : s - P.AM_SLOTS, lo2 = next ? 257 * i : 257 * i + P.AM_BITS;
      before = '<p class="pk-eq">tx_scrambled_' + i + '&lt;256:0&gt;</p><p class="pk-txt">' + blockText(b) + '</p>';
      after = '<p class="pk-eq">tx_scrambled_am&lt;' + (lo2 + 256) + ':' + lo2 + '&gt; = tx_scrambled_' + i + '&lt;256:0&gt;</p><p class="pk-txt">' + blockText(b) + '</p>';
      foot = blockCells(b) + '<p class="note">' + (next
        ? 'Slot ' + s + ' is slot ' + i + ' of the next 10,280-bit block. That block has no AM group, so its 40 blocks pass through unchanged and in order. The next AM group comes 81,920 blocks after this one.'
        : 'AM insertion changes no bit of this block and does not move it: the 4 AM blocks fill the room rate matching freed, so block ' + b + ' keeps slot ' + s + '.') +
        ' Header bit 1 (all four 64-bit payloads are data), then 32 bytes, bit 0 of each byte first. Shown unscrambled.</p>';
    }
    el.innerHTML = h + '<div class="pk-cols"><div><span class="pk-lab">BEFORE</span>' + before + '</div><div><span class="pk-lab">AFTER</span>' + after + '</div></div>' + foot;
  }
  function pickNav(d) { pick = (pick + d + 2 * P.PAIR_SLOTS) % (2 * P.PAIR_SLOTS); sync(); }

  // Open view m on the unit that is in its box right now.
  P.openView = function (m) {
    if (!dlg || !VIEWS[m]) return;
    if (P.inspectorOpen && P.inspectorOpen()) P.closeInspector();
    if (S.playing) P.setPlaying(false);
    mode = m; cur = VIEWS[m].at(); pick = -1; pfPage = 0; distPage = 0;
    step = view().steps; anim = stepping = false; acc = 0;
    $('opv-title').textContent = view().title;
    $('opv-note').textContent = NOTES[m];
    if (!dlg.open) dlg.showModal();
    size(); sync();
  };
  P.closeView = function () { if (dlg && dlg.open) dlg.close(); };
  P.viewOpen = function () { return !!mode; };

  function playToggle() {
    if (!mode) return;
    var N = view().steps;
    if (anim) anim = false;
    else { if (step >= N) step = 0; anim = stepping = true; acc = 0; }
    sync();
  }
  P.viewStep = function () {
    if (!mode) return false;
    var N = view().steps;
    anim = false; stepping = true;
    step = step >= N ? 1 : step + 1;
    sync();
    return true;
  };
  // Pre-FEC and dist views have two pages; flip between them.
  function flipPage() {
    if (mode === 'prefec') pfPage = 1 - pfPage;
    else if (mode === 'dist') distPage = 1 - distPage;
    step = view().steps; anim = stepping = false; acc = 0;
    size(); sync();
  }
  function nav(d) {
    var v = view();
    if (!v || !v.nav) return;
    cur = v.nav(cur, d);
    step = v.steps; anim = stepping = false;
    sync();
  }

  // Called every frame; only redraws when something changed.
  P.viewTick = function (dt) {
    if (!mode) return;
    if (anim) {
      var N = view().steps;
      acc += dt * view().rate;
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
      else if (a === 'pk-prev' || a === 'pk-next') { pickNav(a === 'pk-next' ? 1 : -1); var f = dlg.querySelector('[data-act="' + a + '"]'); if (f) f.focus(); }
      else if (a === 'pk-clear') { pick = -1; sync(); }
      else if (a === 'page') flipPage();
    });
    // AM view: click a slot tile to see what AM insertion did to it.
    function canvasPoint(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    cv.addEventListener('click', function (e) {
      if (mode !== 'am') return;
      var p = canvasPoint(e), s = amHit(p.x, p.y);
      if (s < 0) return;
      pick = s === pick ? -1 : s; sync();
    });
    cv.addEventListener('mousemove', function (e) {
      var p = canvasPoint(e);
      cv.style.cursor = mode === 'am' && amHit(p.x, p.y) >= 0 ? 'pointer' : '';
    });
    dlg.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // Arrow keys walk units; the page buttons beside the canvas turn the pre-FEC pages.
      nav(e.key === 'ArrowRight' ? 1 : -1);
      e.preventDefault();
    });
    // The close event is queued; a view reopened in the meantime must survive it.
    dlg.addEventListener('close', function () { if (!dlg.open) { mode = null; cur = null; anim = stepping = false; } });
    new ResizeObserver(function () { if (mode) size(); }).observe($('opv-wrap'));
    P.on(function (what) { if (mode && (what === 'link' || what === 'payload')) { if (mode === 'mux') size(); sync(); } });
  };
})(globalThis.PCS = globalThis.PCS || {});
