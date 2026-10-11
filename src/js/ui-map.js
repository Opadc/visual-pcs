/* Mapping table, RX order strip and bit scope. */
(function (P) {
  'use strict';
  var S = P.state, $ = function (id) { return document.getElementById(id); };
  var LOCK_TXT = { locked: 'locked', checking: 'checking', searching: 'searching', nolock: 'no lock' };

  P.renderMapping = function () {
    var link = S.link, sel = S.selected;
    function cell(p, label) {
      return '<button type="button" class="oc l' + p + (sel >= 0 && sel !== p ? ' dim' : '') + (sel === p ? ' on' : '') +
        '" data-lane="' + p + '" aria-label="PCS lane ' + p + '">' + label + '</button>';
    }
    var arrive = link.byRxPma.map(function (p) { return cell(p, p); }).join('');
    var after = [0, 1, 2, 3, 4, 5, 6, 7].map(function (p) {
      var L = S.lock[p], ok = S.align;
      return cell(p, ok ? p : (L.state === 'locked' ? p : '?'));
    }).join('');
    $('order-strip').innerHTML =
      '<div class="orow"><span>RX PMA lanes 0–7 carry PCS</span><div>' + arrive + '</div></div>' +
      '<div class="orow"><span>After AM lock + reorder</span><div>' + after + '</div></div>';

    var rows = link.lanes.map(function (l) {
      var lv = P.lockView(S.lock[l.pcs]);
      return '<tr class="' + (sel === l.pcs ? 'on' : '') + (sel >= 0 && sel !== l.pcs ? ' dim' : '') + '" data-lane="' + l.pcs + '">' +
        '<th scope="row"><span class="sw l' + l.pcs + '"></span>' + l.pcs + '</th>' +
        '<td>' + l.txPma + '</td>' +
        '<td>' + l.serdes + (link.k > 1 ? '<small>·' + (l.slot + 1) + '/' + link.k + '</small>' : '') + '</td>' +
        '<td>' + l.rxPma + '</td>' +
        '<td class="num">' + Math.round(l.relSkewNs) + '</td>' +
        '<td><span class="pill ' + lv + '">' + LOCK_TXT[lv] + '</span></td></tr>';
    }).join('');
    $('map-table').innerHTML = '<caption class="sr">PCS lane to SerDes lane mapping</caption>' +
      '<thead><tr><th scope="col">PCS</th><th scope="col">TX PMA</th><th scope="col">SerDes · slot</th>' +
      '<th scope="col">RX PMA</th><th scope="col">Skew ns</th><th scope="col">AM lock</th></tr></thead><tbody>' + rows + '</tbody>';
    var k = link.k;
    $('map-note').textContent = (k === 1
      ? 'One PCS lane per SerDes lane. '
      : k + ' PCS lanes share each SerDes lane, one bit slot each. ') +
      'The assignment is fixed while the link is up. A re-lock or a different mux setting can change which RX PMA lane carries which PCS lane; the alignment markers sort it out.';
  };

  // Bit scope: each row is one TX SerDes lane, newest bits on the right.
  var cv, ctx, dpr = 1, cols = 40;
  P.initScope = function () {
    cv = $('scope'); ctx = cv.getContext('2d');
    new ResizeObserver(sizeScope).observe(cv.parentElement);
    cv.parentElement.addEventListener('click', function (e) {
      var r = cv.getBoundingClientRect(), row = Math.floor((e.clientY - r.top - 22) / rowH());
      var lanes = row >= 0 && row < S.width ? P.lanesOnSerdes(S.link, row) : [];
      if (lanes.length) P.selectLane(lanes[0].pcs === S.selected && lanes[1] ? lanes[1].pcs : lanes[0].pcs);
    });
  };
  function rowH() { return S.width === 8 ? 22 : 34; }
  function sizeScope() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.parentElement.clientWidth, h = 26 + S.width * rowH();
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cols = Math.max(16, Math.min(48, Math.floor((w - 64) / 15)));
    P.drawScope();
  }
  P.sizeScope = sizeScope;

  P.drawScope = function () {
    if (!ctx || !S.link) return;
    var W = cv.width / dpr, link = S.link, k = link.k, f = S.faults, g = P.g.theme, sel = S.selected;
    var pam = S.width < 8, x0 = 60, cw = (W - x0 - 6) / cols, rh = rowH();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, cv.height / dpr);
    ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = g.muted; ctx.textBaseline = 'middle';
    ctx.fillText('older bits', x0, 10);
    ctx.textAlign = 'right'; ctx.fillText('newer bits →', W - 6, 10); ctx.textAlign = 'left';
    var tb = S.u / P.GAP * k, base = Math.floor(tb), frac = tb - base;
    var noiseP = f.noise > 0 ? Math.min(0.5, 0.04 + 0.08 * Math.log10(1 + P.noiseToSer(f.noise) * 1e6)) : 0;
    for (var s = 0; s < S.width; s++) {
      var y = 22 + s * rh, lanes = P.lanesOnSerdes(link, s);
      var dead = f.los && f.losLane === s, noisy = f.noise > 0 && (f.noiseLane < 0 || f.noiseLane === s);
      ctx.fillStyle = g.ink; ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('SD ' + s, 4, y + rh / 2 - (pam ? 5 : 0));
      if (pam) { ctx.fillStyle = g.muted; ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillText('PAM4', 4, y + rh / 2 + 8); }
      for (var c = 0; c <= cols; c++) {
        var b = base - (cols - c);
        var slot = ((b % k) + k) % k, p = lanes[slot].pcs, n = Math.floor(b / k);
        var x = x0 + (c - frac) * cw;
        if (x < x0 - 0.5) continue;
        var isAm = ((n % P.AM_PERIOD) + P.AM_PERIOD) % P.AM_PERIOD === 0;
        var col = dead ? g.muted : g.lanes[p];
        ctx.globalAlpha = sel >= 0 && sel !== p ? 0.18 : 1;
        ctx.fillStyle = col;
        var top = y + 3, hgt = rh - (pam ? 14 : 8);
        ctx.fillRect(x + 1, top, cw - 2, hgt);
        if (isAm && !dead) { ctx.fillStyle = g.paper; ctx.globalAlpha *= 0.55; ctx.fillRect(x + 1, top, cw - 2, hgt / 2); ctx.globalAlpha = sel >= 0 && sel !== p ? 0.18 : 1; }
        if (!dead && noisy && !isAm && P.hash(n, p * 7 + 3) < noiseP) {
          ctx.strokeStyle = g.bad; ctx.lineWidth = 2; ctx.strokeRect(x + 1.5, top + 0.5, cw - 3, hgt - 1);
        }
        if (cw > 11) {
          ctx.fillStyle = g.paper; ctx.font = '600 9px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center';
          ctx.fillText(dead ? '·' : String(P.hash(b, 17) < 0.5 ? 0 : 1), x + cw / 2, top + hgt / 2 + 0.5);
          ctx.textAlign = 'left';
        }
        // PAM4 symbol bracket: two consecutive bits form one symbol.
        if (pam && ((b % 2) + 2) % 2 === 0) {
          ctx.globalAlpha = 0.6; ctx.strokeStyle = g.muted; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x + 2, y + rh - 8); ctx.lineTo(x + 2, y + rh - 5); ctx.lineTo(x + 2 * cw - 2, y + rh - 5); ctx.lineTo(x + 2 * cw - 2, y + rh - 8); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  };

  P.scopeNote = function () {
    var k = S.link.k, w = P.WIDTHS[S.width];
    $('scope-note').textContent = k === 1
      ? 'Each SerDes lane carries one PCS lane, so every bit on a row has the same colour. Pale cells are alignment-marker bits.'
      : 'Bits from ' + k + ' PCS lanes alternate on each SerDes lane, so a row cycles through ' + k + ' colours. Brackets mark ' + w.mod +
        ' symbols of 2 bits: adjacent bits, so one symbol carries bits from two PCS lanes. Pale cells are alignment-marker bits; red outlines are bit errors. Click a row to follow its lanes.';
  };
})(globalThis.PCS = globalThis.PCS || {});
