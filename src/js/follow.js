/* Follow a word through the pipeline. Every drawn block that carries any of the
   word's characters is highlighted, the rest of the scene fades, and floating
   tags show which piece of the word each block holds ("Is", "shma", "ael"). */
(function (P) {
  'use strict';
  var T = window.THREE, G = P.g, S = P.state;
  var word = null, tags = [], tagHost = null, v = new T.Vector3();
  var MAX_TAGS = 48;

  P.followed = function () { return word; };

  // Follow the word containing byte i, or stop with null. Following the same word again stops.
  P.followWord = function (i) {
    var w = i == null ? null : P.wordAround(i);
    if (w && word && w.s === word.s) w = null;
    word = w;
    var bar = document.getElementById('follow-bar');
    if (bar) {
      bar.hidden = !word;
      if (word) bar.querySelector('b').textContent = '“' + word.text + '”';
    }
    if (tagHost) tagHost.hidden = !word;
    P.emit('follow');
  };

  P.initFollow = function (host) {
    tagHost = document.createElement('div');
    tagHost.className = 'follow-tags';
    tagHost.setAttribute('aria-hidden', 'true');
    tagHost.hidden = true;
    host.appendChild(tagHost);
    for (var i = 0; i < MAX_TAGS; i++) {
      var el = document.createElement('span');
      el.className = 'ftag';
      el.style.visibility = 'hidden';
      tagHost.appendChild(el);
      tags.push({ el: el, text: '', shown: false });
    }
    var stop = document.getElementById('follow-stop');
    if (stop) stop.onclick = function () { P.followWord(null); };
    P.on(function (what) { if (what === 'payload' && word) P.followWord(null); });
  };

  // Called by packets.js for each block: returns a tag for the part of the word
  // it holds, or null. Letters between the first and last held letter that the
  // block has no bits of are shown faded, so 'wat?ey' reads as 'watery'.
  P.followPart = function (m) {
    if (!word) return null;
    var cover = P.coverOf(m), mask = cover && P.wordMask(cover, word);
    if (!mask) return null;
    var a = mask.indexOf(true), b = mask.lastIndexOf(true), html = '', key = '';
    for (var i = a; i <= b; i++) {
      var ch = word.text[i];
      html += mask[i] ? ch : '<s>' + ch + '</s>';
      key += mask[i] ? ch : '_';
    }
    return { html: html, key: key, span: b - a + 1 };
  };

  // Place tags over highlighted blocks (after drawPackets, every frame).
  P.updateFollowTags = function () {
    if (!word || !tagHost) return;
    var W = G.w, H = G.h, used = 0, placed = [];
    var hits = P.followHits();
    for (var h = 0; h < hits.length && used < MAX_TAGS; h++) {
      var b = P.packetBox(hits[h].i);
      v.set(b[0], b[1] + b[4] / 2 + 0.35, b[2]).project(G.camera);
      if (v.z > 1) continue;
      var sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
      if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
      var tw = 7 * hits[h].span + 10, r = { x0: sx - tw / 2, x1: sx + tw / 2, y0: sy - 16, y1: sy };
      if (placed.some(function (q) { return r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0; })) continue;
      placed.push(r);
      var t = tags[used++];
      if (t.text !== hits[h].key) { t.el.innerHTML = hits[h].html; t.text = hits[h].key; }
      t.el.className = 'ftag' + (hits[h].lane >= 0 ? ' l' + hits[h].lane : '');
      t.el.style.transform = 'translate(' + Math.round(sx) + 'px,' + Math.round(sy) + 'px) translate(-50%, -100%)';
      if (!t.shown) { t.el.style.visibility = 'visible'; t.shown = true; }
    }
    for (var k = used; k < MAX_TAGS; k++) if (tags[k].shown) { tags[k].el.style.visibility = 'hidden'; tags[k].shown = false; }
  };

  P.followStatus = function () {
    if (!word) return '';
    var lanes = {}, n = 0;
    P.followHits().forEach(function (h) { if (h.lane >= 0) { lanes[h.lane] = 1; n++; } });
    var ls = Object.keys(lanes);
    return ls.length ? 'on PCS lane' + (ls.length > 1 ? 's ' : ' ') + ls.join(', ') : '';
  };
})(globalThis.PCS = globalThis.PCS || {});
