# Block inspector: what each block carries

Click any block in the 3D lane map to see its contents. The animation pauses, the
block is outlined, and a card next to it shows the data. Prev/Next step along the
stream or the lane; "Resume and follow" keeps the card on the block as it moves.

## Data model (simplified for newcomers)

- The MAC sends a repeating ASCII passage (default: the opening of Moby-Dick,
  editable in the toolbar) as plain data bytes. Preamble, FCS, idles and other
  control characters are left out.
- 200GMII transfer n = 66-bit block n = 8 bytes, sync header `01`.
- 257-bit block m = 66-bit blocks 4m..4m+3, header bit `1`, 32 bytes.
- Scrambling is shown by colour only; the card shows the unscrambled text.
- AM groups are inserted between 257-bit blocks and carry no text.
- Pre-FEC distribution cuts the 257-bit stream into 10-bit symbols and
  alternates them between codewords A and B. 40 blocks fill one codeword pair.
  From here until post-FEC interleave on RX, characters are not visible; the
  card shows 10-bit symbols and which bits of which characters each contains.
- RS(544,514) adds 30 parity symbols per codeword, shown as `P`. No real
  Reed–Solomon arithmetic is done.
- Symbol distribution (simplified): each PCS lane takes one symbol from A, then
  one from B, round-robin across the 8 lanes. A PCS lane carries symbols, not
  characters.

## Files

- `src/js/payload.js`: payload bytes and the block/symbol mapping (pure, tested)
- `src/js/inspect-model.js`: describes a picked block (pure)
- `src/js/inspector.js`: picking, outline, card
- `src/js/packets.js`: records an identity for every drawn block
- `test/payload.test.mjs`: bytes survive 66b → 257b → symbols → 257b
