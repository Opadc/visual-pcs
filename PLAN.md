# Visual PCS: data model and scene

The lab follows the IEEE P802.3bs D3.1 Clause 119 transmit equations for
200GBASE-R. Tests in `test/payload.test.mjs` check the model against them.

## Bit model (`src/js/payload.js`)

- The MAC sends a repeating ASCII passage (default: the opening of Moby-Dick)
  as plain data bytes. Preamble, FCS and control characters are left out.
  Scrambling is shown by colour only; bits are the unscrambled ones.
- One codeword pair carries a 10,280-bit block:
  - with an AM group: `am_mapped<1027:0>` then 36 x 257-bit blocks
  - without one: 40 x 257-bit blocks
- AM group (119.2.4.4.1): 8 lane markers from Table 119-1, 10-bit interleaved,
  plus a 65-bit pad (placeholder pattern, not PRBS9) and 3 status bits.
  The standard inserts one every 81,920 blocks (2,048 pairs); the lab uses every pair.
- Pre-FEC distribution (119.2.4.5): m_A symbol i = bits 20i..20i+9,
  m_B symbol i = bits 20i+10..20i+19. Pre-FEC scrambling is not modelled.
- RS(544,514) (`src/js/rs.js`): 514 message + 30 parity symbols over GF(2^10),
  x^10 + x^3 + 1, g(x) = (x - a^0)...(x - a^29). The generator matches the
  802.3bj encoder C model. Parity is computed over the unscrambled bits shown,
  so it differs from what a real link sends.
- Symbol distribution (119.2.4.8): tx_out<8k+2j> = c_A<543-4k-j> on even k,
  c_B on odd k; tx_out symbol s goes to PCS lane s mod 8. Each lane's first
  12 symbols are its own 120-bit marker.

## Scene

- One codeword pair spans the same track length at every stage: 160 x 66-bit
  slots, 40 x 257-bit slots, 17 cubes per codeword (the last is the 30 parity
  symbols), 34 lane cubes of 4 symbols each (the first 3 are the marker).
- Click any block for its contents; click a word to follow it.
- Click a stage box (or its label, or a Bit lens button) for its step view
  (`src/js/lens.js`): a pop-up with input on the left and output on the right,
  for the unit in that box when clicked. Views: 64B/66B, 256B/257B, AM
  insertion, pre-FEC distribution, RS(544,514), symbol distribution, PMA bit-mux.
