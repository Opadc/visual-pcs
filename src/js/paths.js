/* Geometry of the lane journey: y/z of each PCS lane as a function of x. */
(function (P) {
  'use strict';
  function ss(a, b, x) {
    var t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  }
  P.ss = ss;

  // y of the physical SerDes lane `s` (TX numbering), including an optional
  // board-level swap of lanes 0 and 1 in the middle of the channel.
  P.cableY = function (link, s, x) {
    var X = P.X, y = P.ySerdes(s, link.width);
    if (link.lanes.some(function (l) { return l.rxSerdes !== l.serdes; }) && s < 2) {
      var other = P.ySerdes(1 - s, link.width);
      y += (other - y) * ss(X.swap[0], X.swap[1], x);
    }
    return y;
  };

  P.yPath = function (link, lane, x) {
    var X = P.X;
    var y0 = P.yPcs(lane.pcs);
    if (x <= X.mux[0]) return y0;
    var ySd = P.cableY(link, lane.serdes, x);
    if (x <= X.mux[1]) return y0 + (ySd - y0) * ss(X.mux[0], X.mux[1], x);
    if (x <= X.demux[0]) return ySd;
    var yRx = P.yPcs(lane.rxPma);
    if (x <= X.demux[1]) return ySd + (yRx - ySd) * ss(X.demux[0], X.demux[1], x);
    if (x <= X.reorder[0]) return yRx;
    var yOut = P.yPcs(lane.pcs);
    return yRx + (yOut - yRx) * ss(X.reorder[0], X.reorder[1], Math.min(x, X.reorder[1]));
  };

  // Lanes moving in the reorder crossbar bow out in z so crossings stay readable.
  P.zPath = function (link, lane, x) {
    var X = P.X, z = 0;
    if (x > X.reorder[0] && x < X.reorder[1]) {
      var d = lane.pcs - lane.rxPma;
      z += Math.sin(Math.PI * (x - X.reorder[0]) / (X.reorder[1] - X.reorder[0])) * d * 0.28;
    }
    if (x > X.mux[0] && x < X.mux[1] && link.k > 1) {
      z += Math.sin(Math.PI * (x - X.mux[0]) / (X.mux[1] - X.mux[0])) * (lane.slot - (link.k - 1) / 2) * 0.35;
    }
    return z;
  };
})(globalThis.PCS = globalThis.PCS || {});
