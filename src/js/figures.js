/* Static explanatory figures for the narrative, drawn as inline SVG. */
(function (P) {
  'use strict';
  function lane(i) { return 'style="fill:var(--lane-' + i + ')"'; }
  function laneS(i) { return 'style="stroke:var(--lane-' + i + ')"'; }
  function wrap(vb, minW, body, label) {
    return '<svg class="fig" viewBox="' + vb + '" style="min-width:' + minW + 'px" role="img" aria-label="' + label + '">' + body + '</svg>';
  }
  function t(x, y, s, cls) { return '<text x="' + x + '" y="' + y + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + s + '</text>'; }

  function nest() {
    var h = '', y0 = 34, dy = 26;
    for (var i = 0; i < 8; i++) {
      var y = y0 + i * dy;
      h += t(10, y + 4, 'PCS ' + i, 'lab');
      h += '<line x1="62" y1="' + y + '" x2="318" y2="' + y + '" class="ln" ' + laneS(i) + '/>';
      h += t(330, y + 4, 'PMA ' + i, 'sm');
      var s = Math.floor(i / 2), ys = y0 + (s * 2 + 0.5) * dy;
      h += '<path d="M380 ' + y + ' C 410 ' + y + ', 410 ' + ys + ', 440 ' + ys + '" class="ln thin" ' + laneS(i) + '/>';
    }
    h += '<line x1="322" y1="14" x2="322" y2="236" class="dash"/>';
    h += '<rect x="376" y="20" width="70" height="210" class="blk"/>' + t(411, 250, 'PMA mux', 'mid');
    for (var s2 = 0; s2 < 4; s2++) {
      var yc = y0 + (s2 * 2 + 0.5) * dy;
      h += '<rect x="452" y="' + (yc - 10) + '" width="380" height="20" rx="10" class="sheath"/>';
      for (var k = 0; k < 30; k++) {
        h += '<rect x="' + (462 + k * 12) + '" y="' + (yc - 4) + '" width="9" height="8" ' + lane(s2 * 2 + (k % 2)) + '/>';
      }
      h += t(842, yc + 4, 'SerDes ' + s2, 'lab');
    }
    h += t(62, 262, 'PCS lanes: logical, identified by AMs', 'cap');
    h += t(300, 262, '', 'cap');
    h += t(452, 262, 'SerDes lanes: physical, 2 PCS lanes bit-interleaved on each', 'cap');
    h += t(330, 10, 'PCS/PMA service interface', 'sm');
    return wrap('0 0 920 272', 620, h, 'Eight PCS lanes become eight PMA lanes, then are multiplexed two per SerDes lane onto four SerDes lanes');
  }

  function transcode() {
    var h = '';
    for (var i = 0; i < 4; i++) {
      var y = 18 + i * 34;
      h += '<rect x="20" y="' + y + '" width="16" height="24" class="hdr"/><rect x="38" y="' + y + '" width="200" height="24" class="pay"/>';
      h += t(28, y + 16, '2', 'in mid') + t(138, y + 16, '64-bit payload', 'in mid');
    }
    h += t(20, 168, '4 × 66-bit blocks = 264 bits', 'cap');
    h += '<path d="M260 80 L 330 80" class="arrow"/><path d="M322 74 L 332 80 L 322 86" class="arrowhead"/>';
    h += t(296, 70, 'transcode', 'sm mid');
    h += '<rect x="350" y="64" width="10" height="34" class="hdr"/>';
    h += '<rect x="362" y="64" width="380" height="34" class="pay"/>';
    for (var j = 1; j < 4; j++) h += '<line x1="' + (362 + j * 95) + '" y1="64" x2="' + (362 + j * 95) + '" y2="98" class="seam"/>';
    h += t(552, 86, '256 bits: the same four payloads', 'in mid');
    h += t(350, 120, '1 header bit; block types fold into the payload when control is present', 'cap');
    h += t(350, 168, '1 × 257-bit block', 'cap');
    return wrap('0 0 760 180', 560, h, 'Four 66-bit blocks are transcoded into one 257-bit block');
  }

  function dist() {
    var h = '', x0 = 76, y0 = 30, cw = 44, ch = 22, cols = 14;
    for (var r = 0; r < 8; r++) {
      var y = y0 + r * (ch + 4);
      h += '<rect x="10" y="' + (y + 6) + '" width="10" height="10" ' + lane(r) + '/>' + t(26, y + 15, 'PCS ' + r, 'lab');
      for (var c = 0; c < cols; c++) {
        var a = (r + c) % 2 === 0;
        h += '<rect x="' + (x0 + c * cw) + '" y="' + y + '" width="' + (cw - 4) + '" height="' + ch + '" class="' + (a ? 'cwa' : 'cwb') + '"/>';
        h += t(x0 + c * cw + (cw - 4) / 2, y + 15, a ? 'A' : 'B', 'in mid' + (a ? '' : ' dark'));
      }
    }
    h += t(x0, 18, '10-bit symbols, time →', 'sm');
    return wrap('0 0 700 240', 560, h, 'Checkerboard of codeword A and B symbols across eight PCS lanes');
  }

  function am() {
    var cells = ['CM0', 'CM1', 'CM2', 'UP0', 'CM3', 'CM4', 'CM5', 'UP1', 'UM0', 'UM1', 'UM2', 'UP2', 'UM3', 'UM4', 'UM5'];
    var h = '', w = 47;
    cells.forEach(function (c, i) {
      var cls = c[1] === 'M' && c[0] === 'C' ? 'cm' : c[0] === 'U' && c[1] === 'M' ? 'um' : 'up';
      h += '<rect x="' + (10 + i * w) + '" y="26" width="' + (w - 3) + '" height="34" class="' + cls + '"' + (cls === 'um' ? ' ' + lane(5) : '') + '/>';
      h += t(10 + i * w + (w - 3) / 2, 48, c, 'in mid' + (cls === 'up' ? ' dark' : ''));
    });
    h += t(10, 16, '120 bits, first byte sent on the left', 'sm');
    h += '<rect x="10" y="78" width="12" height="12" class="cm"/>' + t(28, 88, 'Common: identical on all lanes, used to find the marker', 'cap');
    h += '<rect x="10" y="98" width="12" height="12" class="um" ' + lane(5) + '/>' + t(28, 108, 'Unique: different per lane, names the PCS lane', 'cap');
    h += '<rect x="10" y="118" width="12" height="12" class="up"/>' + t(28, 128, 'Unique pad: varies per lane, ignored on receive', 'cap');
    return wrap('0 0 720 140', 560, h, 'Alignment marker layout: common, unique and pad bytes');
  }

  function mux() {
    var h = '', x0 = 90, bw = 30;
    h += t(10, 30, 'PCS 0', 'lab') + t(10, 70, 'PCS 1', 'lab');
    for (var i = 0; i < 8; i++) {
      h += '<rect x="' + (x0 + i * bw * 2) + '" y="18" width="' + (bw * 2 - 4) + '" height="18" ' + lane(0) + '/>' + t(x0 + i * bw * 2 + bw - 2, 31, 'a' + i, 'in mid');
      h += '<rect x="' + (x0 + i * bw * 2 + bw / 2) + '" y="58" width="' + (bw * 2 - 4) + '" height="18" ' + lane(1) + '/>' + t(x0 + i * bw * 2 + bw * 1.5 - 2, 71, 'b' + i, 'in mid');
    }
    h += t(10, 132, 'SerDes 0', 'lab');
    for (var j = 0; j < 16; j++) {
      var p = j % 2, x = x0 + j * bw;
      h += '<rect x="' + x + '" y="118" width="' + (bw - 3) + '" height="22" ' + lane(p) + '/>' + t(x + (bw - 3) / 2, 133, (p ? 'b' : 'a') + Math.floor(j / 2), 'in mid');
      if (j % 2 === 0) h += '<path d="M' + (x + 1) + ' 146 v5 h' + (2 * bw - 5) + ' v-5" class="brk"/>' + t(x + bw - 2, 166, 'PAM4', 'sm mid');
    }
    h += '<path d="M380 84 L 380 110" class="arrow"/><path d="M374 102 L 380 112 L 386 102" class="arrowhead"/>';
    h += t(392, 102, 'bit-interleave at 2× the rate', 'sm');
    return wrap('0 0 600 176', 560, h, 'Two PCS lanes bit-interleaved onto one PAM4 SerDes lane');
  }

  function deskew() {
    var h = '', order = [2, 3, 0, 1, 6, 7, 4, 5], skew = [30, 30, 0, 0, 64, 64, 14, 14];
    h += t(10, 16, 'At RX PMA output: arbitrary order, skewed', 'sm');
    h += t(400, 16, 'After deskew and reorder', 'sm');
    for (var r = 0; r < 8; r++) {
      var y = 28 + r * 24, p = order[r];
      h += t(10, y + 12, 'PMA ' + r, 'sm');
      h += '<rect x="58" y="' + (y + 4) + '" width="290" height="8" class="trk" ' + lane(p) + '/>';
      h += '<rect x="' + (120 + skew[r]) + '" y="' + y + '" width="9" height="16" ' + lane(p) + ' class="amk"/>';
      h += t(140 + skew[r], y + 12, 'AM ' + p, 'sm');
      h += t(400, y + 12, 'PCS ' + r, 'sm');
      h += '<rect x="448" y="' + (y + 4) + '" width="250" height="8" class="trk" ' + lane(r) + '/>';
      h += '<rect x="584" y="' + y + '" width="9" height="16" ' + lane(r) + ' class="amk"/>';
    }
    h += '<line x1="588" y1="22" x2="588" y2="222" class="dash"/>';
    return wrap('0 0 720 232', 600, h, 'Alignment markers arrive skewed and out of order, then line up after deskew and reorder');
  }

  P.drawFigures = function () {
    var map = { 'fig-nest': nest, 'fig-transcode': transcode, 'fig-dist': dist, 'fig-am': am, 'fig-mux': mux, 'fig-deskew': deskew };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = map[id]();
    });
  };
})(globalThis.PCS = globalThis.PCS || {});
