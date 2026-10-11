/* Diagnostics panel: conceptual readouts, split into standard concepts and
   implementation-specific telemetry. Built once, values patched in place. */
(function (P) {
  'use strict';
  var S = P.state, $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };

  var STD = [
    { id: 'align', name: 'PCS alignment status', help: 'True only when all 8 PCS lanes have AM lock and are deskewed. False means the RX PCS cannot decode anything and the MAC sees Local Fault. This is the first thing to read.' },
    { id: 'lock', name: 'AM lock, per PCS lane', help: 'Which lanes the receiver can identify. A set of lanes failing together usually shares one SerDes lane, so look at the physical lane first. A single lane failing while its SerDes neighbours are fine points at whatever handles the lane content (a mux setting, a test pattern, a host-side issue).' },
    { id: 'order', name: 'Lane mapping and deskew', help: 'Which RX PMA lane each PCS lane arrived on. Any order is legal and it may change after a reset. Repeated or missing lane numbers mean a mux configuration problem. Deskew fails when the spread between lanes exceeds what the receiver can buffer.' },
    { id: 'corr', name: 'FEC corrected codewords', help: 'Codewords that had at least one symbol error and were fixed. Expected to grow on a healthy PAM4 link. Watch the rate and its trend, not the fact that it is non-zero.' },
    { id: 'unc', name: 'FEC uncorrectable codewords', help: 'Codewords with more than 15 errored symbols. Should stay at zero. Any growth means corrupted frames reach the MAC (FCS errors), even if the link reports up.' },
    { id: 'sym', name: 'FEC symbol errors, per PCS lane', help: 'Where the errors are. Map the noisiest PCS lanes back to their SerDes lane through the mapping table: errors concentrated on lanes that share a SerDes lane identify the weak physical lane.' }
  ];
  var IMPL = [
    { id: 'skew', name: 'Measured skew, per lane', help: 'Often exposed as AM arrival offset or deskew FIFO depth. Margin under the budget matters more than the absolute value; lanes drifting toward it point at a long trace or a retimer adding latency.' },
    { id: 'ser', name: 'Pre-FEC error rate estimate', help: 'Symbol errors divided by symbols received, over the counting window. Vendors report this as SER or as an estimated BER with their own formulas, so compare readings from the same device only.' },
    { id: 'hist', name: 'Codeword error histogram', help: 'How many codewords had 0, 1, 2 … errored symbols. A healthy link keeps its weight at the left. Weight creeping toward 15 means the link is running out of FEC margin before any uncorrectable codeword appears.' }
  ];

  function row(r) {
    return '<div class="drow" id="d-' + r.id + '"><details><summary><span class="dname">' + r.name + '</span>' +
      '<span class="dval" id="dv-' + r.id + '"></span></summary><p>' + r.help + '</p></details>' +
      '<div class="dviz" id="dz-' + r.id + '"></div></div>';
  }

  P.initDiag = function () {
    $('diag').innerHTML =
      '<div class="dbanner" id="d-banner" role="status"></div>' +
      '<h4 class="dgroup">Standard-defined concepts <small>IEEE 802.3 Clause 119 PCS and RS-FEC</small></h4>' +
      STD.map(row).join('') +
      '<h4 class="dgroup impl">Implementation-specific telemetry <small>varies by device</small></h4>' +
      IMPL.map(row).join('') +
      '<p class="dfoot" id="d-foot"></p>';
  };

  function dots(fn) {
    var h = '';
    for (var p = 0; p < 8; p++) h += fn(p);
    return '<div class="dots">' + h + '</div>';
  }

  P.renderDiag = function () {
    var c = S.c, link = S.link, last = S.lastTick, sel = S.selected;
    var banner = $('d-banner'), cls, txt;
    if (!S.align) {
      var why = S.lock.some(function (L) { return L.state !== 'locked'; }) ? 'a PCS lane has no AM lock' : 'skew exceeds the deskew budget';
      cls = 'bad'; txt = 'Link down · align_status false: ' + why + '. MAC sees Local Fault.';
    } else if (S.recentUnc > 0.5) {
      cls = 'bad'; txt = 'Link up, dropping data · uncorrectable codewords are increasing.';
    } else if (last && last.lam > 2) {
      cls = 'warn'; txt = 'Link up · FEC working hard. Corrections are high; margin is shrinking.';
    } else { cls = 'ok'; txt = 'Link up · aligned, FEC correcting normally.'; }
    banner.className = 'dbanner ' + cls; banner.textContent = txt;

    $('dv-align').innerHTML = '<span class="pill ' + (S.align ? 'locked' : 'nolock') + '">' + (S.align ? 'true' : 'false') + '</span>';
    var nLocked = S.lock.filter(function (L) { return L.state === 'locked'; }).length;
    $('dv-lock').textContent = nLocked + ' / 8 locked';
    $('dz-lock').innerHTML = dots(function (p) {
      var v = P.lockView(S.lock[p]);
      return '<span class="dot ' + v + (sel >= 0 && sel !== p ? ' dim' : '') + '" title="PCS ' + p + ': ' + v + '">' + p + '</span>';
    });
    $('dv-order').innerHTML = '<span class="pill ' + (link.deskewOk ? 'locked' : 'nolock') + '">deskew ' + (link.deskewOk ? 'ok' : 'fail') + '</span>';
    $('dz-order').innerHTML = '<div class="maprow">' + link.byRxPma.map(function (p, i) {
      return '<span class="mp"><small>RX ' + i + '</small><b class="l' + p + '">PCS ' + p + '</b></span>';
    }).join('') + '</div>';

    $('dv-corr').innerHTML = fmt(c.corrected) + (last && S.align ? '<small>+' + fmt(last.corrected) + '/ms</small>' : '');
    $('dv-unc').innerHTML = '<span class="' + (c.uncorrectable ? 'badtxt' : '') + '">' + fmt(c.uncorrectable) + '</span>' +
      (last && S.align && last.uncorrectable ? '<small class="badtxt">+' + fmt(last.uncorrectable) + '/ms</small>' : '');
    $('dv-sym').textContent = fmt(c.symbolErrors);
    var maxL = Math.max.apply(null, c.symLane.concat([1]));
    $('dz-sym').innerHTML = bars(c.symLane, function (v) { return v ? Math.log10(1 + v) / Math.log10(1 + maxL) : 0; }, fmt);

    $('dv-skew').textContent = 'spread ' + Math.round(link.spreadNs) + ' ns of ' + P.DESKEW_CAP_NS;
    $('dz-skew').innerHTML = bars(link.lanes.map(function (l) { return l.relSkewNs; }),
      function (v) { return Math.min(v / 250, 1); }, function (v) { return Math.round(v) + ' ns'; }, P.DESKEW_CAP_NS / 250);
    var syms = c.codewords * P.RS_N;
    $('dv-ser').textContent = syms ? (c.symbolErrors / syms).toExponential(2) + ' SER' : '—';
    var hist = c.hist, hmax = Math.max.apply(null, hist.concat([1]));
    $('dz-hist').innerHTML = '<div class="hist">' + hist.map(function (v, i) {
      var h = v ? 8 + 92 * Math.log10(1 + v) / Math.log10(1 + hmax) : 0;
      return '<span class="hb' + (i > P.RS_T ? ' over' : '') + '" style="height:' + h.toFixed(1) + '%" title="' +
        (i > P.RS_T ? '>15' : i) + ' errored symbols: ' + fmt(v) + '"></span>';
    }).join('') + '</div><div class="haxis"><span>0</span><span>t = 15</span><span>&gt;15</span></div>';
    $('dv-hist').textContent = fmt(c.codewords) + ' codewords';
    $('d-foot').textContent = 'Simulated link time ' + (S.simMs / 1000).toFixed(2) + ' s (one update per ms of link time, ' +
      fmt(P.CW_PER_TICK) + ' codewords). Counter widths, read behaviour (clear-on-read, latched, saturating) and register locations are device-specific.';
  };

  function bars(vals, scale, label, capAt) {
    var sel = S.selected;
    return '<div class="bars">' + vals.map(function (v, p) {
      return '<span class="bar' + (sel >= 0 && sel !== p ? ' dim' : '') + '" title="PCS ' + p + ': ' + label(v) + '"><em>' + p +
        '</em><span class="track"><i class="l' + p + '" style="width:' + (scale(v) * 100).toFixed(1) + '%"></i>' +
        (capAt ? '<b class="capline" style="left:' + (capAt * 100).toFixed(1) + '%"></b>' : '') + '</span></span>';
    }).join('') + '</div>';
  }
})(globalThis.PCS = globalThis.PCS || {});
