/*
 * OfficeCrypto — opens password-protected Office files (ECMA-376 "agile" encryption)
 * entirely in the browser using WebCrypto. PNB One statements are .xlsx files
 * wrapped in this scheme (AES-128-CBC, SHA-1). Works in browsers and Node 22+.
 *
 * API:
 *   OfficeCrypto.isEncrypted(bytes)             -> boolean (compound-file signature)
 *   OfficeCrypto.decrypt(bytes, password)       -> Promise<Uint8Array> (the plain .xlsx zip)
 *     rejects with Error whose .code is 'WRONG_PASSWORD' | 'UNSUPPORTED' | 'CORRUPT'
 */
(function (root) {
  'use strict';

  const subtle = root.crypto && root.crypto.subtle;
  const ENDOFCHAIN = 0xfffffffe;
  const FREESECT = 0xffffffff;

  function err(code, msg) {
    const e = new Error(msg);
    e.code = code;
    return e;
  }

  function toU8(buf) {
    if (buf instanceof Uint8Array) return buf;
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
    if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    throw err('CORRUPT', 'Unsupported input');
  }

  function concat(...arrs) {
    let n = 0;
    for (const a of arrs) n += a.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }

  function isEncrypted(bytes) {
    const u8 = toU8(bytes);
    const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (u8.length < 512) return false;
    for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) return false;
    return true;
  }

  // ---------------------------------------------------------------- CFB
  function parseCFB(bytes) {
    const u8 = toU8(bytes);
    if (!isEncrypted(u8)) throw err('CORRUPT', 'Not a compound file');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const majorVersion = dv.getUint16(0x1a, true);
    const sectorSize = 1 << dv.getUint16(0x1e, true);
    const miniSize = 1 << dv.getUint16(0x20, true);
    const numFat = dv.getUint32(0x2c, true);
    const firstDir = dv.getUint32(0x30, true);
    const miniCutoff = dv.getUint32(0x38, true);
    const firstMiniFat = dv.getUint32(0x3c, true);
    const firstDifat = dv.getUint32(0x44, true);
    const numDifat = dv.getUint32(0x48, true);
    const perSector = sectorSize / 4;
    const secOff = (s) => (s + 1) * sectorSize;

    const fatSectors = [];
    for (let i = 0; i < 109 && fatSectors.length < numFat; i++) {
      const v = dv.getUint32(0x4c + i * 4, true);
      if (v !== FREESECT) fatSectors.push(v);
    }
    let difat = firstDifat;
    let guard = 0;
    while (difat !== ENDOFCHAIN && difat !== FREESECT && guard++ <= numDifat) {
      const off = secOff(difat);
      for (let i = 0; i < perSector - 1 && fatSectors.length < numFat; i++) {
        const v = dv.getUint32(off + i * 4, true);
        if (v !== FREESECT) fatSectors.push(v);
      }
      difat = dv.getUint32(off + (perSector - 1) * 4, true);
    }

    function loadTable(sectors) {
      const t = new Uint32Array(sectors.length * perSector);
      sectors.forEach((s, i) => {
        const off = secOff(s);
        for (let j = 0; j < perSector; j++) t[i * perSector + j] = dv.getUint32(off + j * 4, true);
      });
      return t;
    }
    const fat = loadTable(fatSectors);

    function chain(start, table) {
      const out = [];
      let s = start;
      while (s !== ENDOFCHAIN && s !== FREESECT && s < 0xfffffffa) {
        out.push(s);
        if (out.length > table.length + 1) throw err('CORRUPT', 'Corrupt sector chain');
        s = table[s];
      }
      return out;
    }

    function readChain(start, size) {
      const secs = chain(start, fat);
      const out = new Uint8Array(secs.length * sectorSize);
      secs.forEach((s, i) => out.set(u8.subarray(secOff(s), secOff(s) + sectorSize), i * sectorSize));
      return size == null ? out : out.subarray(0, size);
    }

    const dirBytes = readChain(firstDir);
    const entries = [];
    for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
      const d = new DataView(dirBytes.buffer, dirBytes.byteOffset + off, 128);
      const type = d.getUint8(0x42);
      if (type === 0) continue;
      const nameLen = d.getUint16(0x40, true);
      let name = '';
      for (let i = 0; i + 1 < nameLen - 1 && i < 64; i += 2) name += String.fromCharCode(d.getUint16(i, true));
      const start = d.getUint32(0x74, true);
      const size = majorVersion === 3 ? d.getUint32(0x78, true) : Number(d.getBigUint64(0x78, true));
      entries.push({ name, type, start, size });
    }
    const rootEntry = entries.find((e) => e.type === 5);

    let miniFat = null;
    let miniStream = null;
    function readStream(name) {
      const e = entries.find((x) => x.type === 2 && x.name === name);
      if (!e) return null;
      if (e.size < miniCutoff) {
        if (!miniFat) {
          miniFat = loadTable(chain(firstMiniFat, fat));
          miniStream = readChain(rootEntry.start, rootEntry.size);
        }
        const secs = chain(e.start, miniFat);
        const out = new Uint8Array(secs.length * miniSize);
        secs.forEach((s, i) => out.set(miniStream.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize));
        return out.subarray(0, e.size);
      }
      return readChain(e.start, e.size);
    }

    return { entries, readStream };
  }

  // ---------------------------------------------------------------- SHA-1 (sync, for the 100k spin loop)
  function sha1(msg) {
    const ml = msg.length;
    const withOne = ml + 1;
    const padLen = (withOne % 64 <= 56 ? 56 - (withOne % 64) : 120 - (withOne % 64));
    const total = withOne + padLen + 8;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[ml] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor((ml * 8) / 0x100000000), false);
    dv.setUint32(total - 4, (ml * 8) >>> 0, false);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 80; i++) {
        const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
        w[i] = (x << 1) | (x >>> 31);
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const out = new Uint8Array(20);
    const odv = new DataView(out.buffer);
    odv.setUint32(0, h0, false); odv.setUint32(4, h1, false); odv.setUint32(8, h2, false);
    odv.setUint32(12, h3, false); odv.setUint32(16, h4, false);
    return out;
  }

  const HASH_NAMES = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
  function hashName(alg) {
    const key = String(alg || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const n = HASH_NAMES[key];
    if (!n) throw err('UNSUPPORTED', 'Unsupported hash algorithm: ' + alg);
    return n;
  }

  async function digest(alg, data) {
    if (alg === 'SHA-1') return sha1(data);
    if (!subtle) throw err('UNSUPPORTED', 'WebCrypto is not available');
    return new Uint8Array(await subtle.digest(alg, data));
  }

  function utf16le(str) {
    const out = new Uint8Array(str.length * 2);
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      out[i * 2] = c & 255;
      out[i * 2 + 1] = c >> 8;
    }
    return out;
  }

  function b64(s) {
    const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  function attrsOf(xml, tagRe) {
    const m = xml.match(tagRe);
    if (!m) return null;
    const out = {};
    const re = /([\w:]+)="([^"]*)"/g;
    let a;
    while ((a = re.exec(m[1]))) out[a[1].replace(/^\w+:/, '')] = a[2];
    return out;
  }

  // Iterated hash H_n = H(LE32(n) || H_{n-1}), H_0 = H(salt || password)
  async function iteratedHash(alg, salt, password, spinCount) {
    let h = await digest(alg, concat(salt, utf16le(password)));
    const buf = new Uint8Array(4 + h.length);
    for (let i = 0; i < spinCount; i++) {
      buf[0] = i & 255; buf[1] = (i >>> 8) & 255; buf[2] = (i >>> 16) & 255; buf[3] = (i >>> 24) & 255;
      buf.set(h, 4);
      h = await digest(alg, buf);
    }
    return h;
  }

  async function blockKey(alg, hFinal, block, keyBytes) {
    const h = await digest(alg, concat(hFinal, block));
    if (h.length >= keyBytes) return h.subarray(0, keyBytes);
    const out = new Uint8Array(keyBytes).fill(0x36);
    out.set(h);
    return out;
  }

  // AES-CBC without PKCS#7: WebCrypto always unpads, so append one block that decrypts to valid padding.
  async function aesCbcDecryptNoPad(keyBytes, iv, data) {
    if (!subtle) throw err('UNSUPPORTED', 'WebCrypto is not available');
    if (data.length % 16 !== 0) throw err('CORRUPT', 'Ciphertext not block aligned');
    const key = await subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
    const last = data.subarray(data.length - 16);
    const padBlock = new Uint8Array(16).fill(16);
    const tail = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: last }, key, padBlock)).subarray(0, 16);
    const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv }, key, concat(data, tail)));
    return plain;
  }

  function equalBytes(a, b, n) {
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  async function decrypt(bytes, password) {
    const cfb = parseCFB(bytes);
    const info = cfb.readStream('EncryptionInfo');
    const pkg = cfb.readStream('EncryptedPackage');
    if (!info || !pkg) throw err('CORRUPT', 'EncryptionInfo / EncryptedPackage streams missing');
    const idv = new DataView(info.buffer, info.byteOffset, info.byteLength);
    const major = idv.getUint16(0, true);
    const minor = idv.getUint16(2, true);
    if (!(major === 4 && minor === 4)) {
      throw err('UNSUPPORTED', 'This file uses the older "standard" Office encryption. Open it in Excel and save a copy without a password.');
    }
    const xml = new TextDecoder('utf-8').decode(info.subarray(8));
    const keyData = attrsOf(xml, /<(?:\w+:)?keyData\b([^>]*)\/?>/);
    const pw = attrsOf(xml, /<(?:\w+:)?encryptedKey\b([^>]*)\/?>/);
    if (!keyData || !pw) throw err('CORRUPT', 'EncryptionInfo XML not understood');

    const pwHash = hashName(pw.hashAlgorithm);
    const keyBytes = parseInt(pw.keyBits, 10) / 8;
    const spin = parseInt(pw.spinCount, 10) || 100000;
    const pwSalt = b64(pw.saltValue);
    const hFinal = await iteratedHash(pwHash, pwSalt, String(password), spin);

    const BK_INPUT = new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
    const BK_VALUE = new Uint8Array([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
    const BK_KEY = new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);

    const kInput = await blockKey(pwHash, hFinal, BK_INPUT, keyBytes);
    const verifierInput = await aesCbcDecryptNoPad(kInput, pwSalt, b64(pw.encryptedVerifierHashInput));
    const kValue = await blockKey(pwHash, hFinal, BK_VALUE, keyBytes);
    const verifierValue = await aesCbcDecryptNoPad(kValue, pwSalt, b64(pw.encryptedVerifierHashValue));
    const expected = await digest(pwHash, verifierInput.subarray(0, parseInt(pw.saltSize, 10) || 16));
    const hashSize = parseInt(pw.hashSize, 10) || expected.length;
    if (!equalBytes(expected, verifierValue, hashSize)) throw err('WRONG_PASSWORD', 'Wrong password');

    const kKey = await blockKey(pwHash, hFinal, BK_KEY, keyBytes);
    const secret = (await aesCbcDecryptNoPad(kKey, pwSalt, b64(pw.encryptedKeyValue))).subarray(0, parseInt(keyData.keyBits, 10) / 8);

    const pdv = new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength);
    const size = Number(pdv.getBigUint64(0, true));
    const body = pkg.subarray(8);
    const dataHash = hashName(keyData.hashAlgorithm);
    const blockSize = parseInt(keyData.blockSize, 10) || 16;
    const dataSalt = b64(keyData.saltValue);
    const SEG = 4096;
    const segments = Math.ceil(size / SEG);
    const jobs = [];
    for (let i = 0; i < segments; i++) {
      const idx = new Uint8Array([i & 255, (i >>> 8) & 255, (i >>> 16) & 255, (i >>> 24) & 255]);
      const start = i * SEG;
      let end = Math.min(start + SEG, body.length);
      end = start + Math.ceil((end - start) / 16) * 16;
      const slice = body.subarray(start, Math.min(end, body.length));
      jobs.push(digest(dataHash, concat(dataSalt, idx)).then((h) => aesCbcDecryptNoPad(secret, h.subarray(0, blockSize), slice)));
    }
    const parts = await Promise.all(jobs);
    return concat(...parts).subarray(0, size);
  }

  const api = { isEncrypted, decrypt, parseCFB, sha1, _internal: { aesCbcDecryptNoPad } };
  root.OfficeCrypto = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
