/* Message tracker: show ASCII before FEC, hex in FEC zone, ASCII after FEC. */
(function (P) {
  'use strict';
  var S = P.state, $ = function (id) { return document.getElementById(id); };

  P.renderMessage = function () {
    var msg = S.messageContent || 'Call me Ishmael';
    var len = msg.length;
    var detail = $('msg-detail');
    if (!detail) return;

    var zones = [
      { x: [-2, 24.5], name: 'TX: MAC → Pre-FEC', show: 'ascii' },
      { x: [24.5, 83.5], name: 'FEC zone: Pre-FEC → Post-FEC interleave', show: 'hex' },
      { x: [83.5, 116], name: 'RX: Post-FEC → MAC', show: 'ascii' }
    ];

    var html = '<div class="msg-zones">';
    zones.forEach(function (z) {
      var here = S.u >= z.x[0] && S.u <= z.x[1];
      html += '<div class="msg-zone' + (here ? ' active' : '') + '"><span class="name">' + z.name + '</span>' +
        '<span class="type">' + (z.show === 'ascii' ? 'ASCII readable' : '10-bit symbols') + '</span></div>';
    });
    html += '</div>';

    html += '<div class="msg-lanes"><span class="mlabel">Per-lane content:</span>';
    for (var i = 0; i < 8; i++) {
      var slice = P.messageLaneSlice(i).map(function (c) { return String.fromCharCode(c); }).join('');
      html += '<div class="mlane l' + i + '"><small>Lane ' + i + '</small><code>' + (slice || '(empty)') + '</code></div>';
    }
    html += '</div>';

    html += '<p class="msg-note">Message flows through the pipeline: readable as text before Pre-FEC and after Post-FEC interleave, ' +
      'hidden as 10-bit symbols during FEC encoding/decoding (byte alignment breaks, ' +
      'so characters are no longer visible). Each lane carries every ' + (8 / len === Math.floor(8 / len) ? Math.floor(8 / len) : '~1 of ' + len) + ' character.</p>';

    detail.innerHTML = html;
  };

  P.on(function (what) {
    if (what === 'message' || what === 'link' || what === 'play' || what === 'stage') {
      P.renderMessage();
    }
  });
})(globalThis.PCS = globalThis.PCS || {});
