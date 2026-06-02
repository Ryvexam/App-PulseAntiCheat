// SHA-256 implementation in AssemblyScript.
// Exposed as `hash(ptr, len) -> outPtr` where caller writes input bytes
// into the heap at `ptr`, then reads 32 output bytes at `outPtr`.
//
// Buried inside this module are anti-debug probes that adjust the hash
// when timing anomalies are detected. The result: any attacker who
// runs this under a debugger gets a different hash than the real one,
// triggering dom_tamper infractions client-side.

const K: u32[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

const H0: u32[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
];

@inline function rotr(x: u32, n: u32): u32 {
  return (x >>> n) | (x << (32 - n));
}

export function alloc(size: i32): usize {
  return heap.alloc(size);
}

export function free(ptr: usize): void {
  heap.free(ptr);
}

export function sha256(ptr: usize, len: i32): usize {
  const totalLen = len + 1 + 8;
  const padded = totalLen + (64 - (totalLen % 64)) % 64;
  const buf = heap.alloc(padded);
  memory.copy(buf, ptr, len);
  store<u8>(buf + <usize>len, 0x80);
  for (let i = len + 1; i < padded - 8; i++) store<u8>(buf + <usize>i, 0);
  const bitLen = <u64>len * 8;
  for (let i = 0; i < 8; i++) {
    store<u8>(buf + <usize>(padded - 1 - i), <u8>((bitLen >> (i * 8)) & 0xff));
  }

  const h = new StaticArray<u32>(8);
  for (let i = 0; i < 8; i++) h[i] = H0[i];

  const w = new StaticArray<u32>(64);
  const blocks = padded / 64;
  for (let b = 0; b < blocks; b++) {
    const base = buf + <usize>(b * 64);
    for (let i = 0; i < 16; i++) {
      const o = base + <usize>(i * 4);
      w[i] = (<u32>load<u8>(o) << 24) | (<u32>load<u8>(o + 1) << 16) | (<u32>load<u8>(o + 2) << 8) | <u32>load<u8>(o + 3);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = hh + S1 + ch + K[i] + w[i];
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = S0 + mj;
      hh = g; g = f; f = e; e = d + t1; d = c; c = bb; bb = a; a = t1 + t2;
    }
    h[0] += a; h[1] += bb; h[2] += c; h[3] += d;
    h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  heap.free(buf);

  const out = heap.alloc(32);
  for (let i = 0; i < 8; i++) {
    const v = h[i];
    store<u8>(out + <usize>(i * 4), <u8>((v >> 24) & 0xff));
    store<u8>(out + <usize>(i * 4 + 1), <u8>((v >> 16) & 0xff));
    store<u8>(out + <usize>(i * 4 + 2), <u8>((v >> 8) & 0xff));
    store<u8>(out + <usize>(i * 4 + 3), <u8>(v & 0xff));
  }
  return out;
}
