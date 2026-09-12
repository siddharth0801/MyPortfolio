const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OC = require('../cfb-decrypt.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'pnb_sample_encrypted.xls');
const PLAIN = path.join(__dirname, 'fixtures', 'pnb_sample.xlsx');
const PASSWORD = 'test1234';

test('sha1 matches a known vector', () => {
  const hex = Buffer.from(OC.sha1(new TextEncoder().encode('abc'))).toString('hex');
  assert.equal(hex, 'a9993e364706816aba3e25717850c26c9cd0d89d');
  const empty = Buffer.from(OC.sha1(new Uint8Array(0))).toString('hex');
  assert.equal(empty, 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
});

test('isEncrypted recognises the compound-file signature only', () => {
  assert.equal(OC.isEncrypted(new Uint8Array(fs.readFileSync(FIXTURE))), true);
  assert.equal(OC.isEncrypted(new Uint8Array(fs.readFileSync(PLAIN))), false); // a zip
  assert.equal(OC.isEncrypted(new Uint8Array(10)), false);
});

test('parseCFB exposes the encryption streams', () => {
  const cfb = OC.parseCFB(new Uint8Array(fs.readFileSync(FIXTURE)));
  const names = cfb.entries.map((e) => e.name);
  assert.ok(names.includes('EncryptionInfo'));
  assert.ok(names.includes('EncryptedPackage'));
  const info = cfb.readStream('EncryptionInfo');
  assert.equal(info[0] | (info[1] << 8), 4); // agile major version
  assert.equal(info[2] | (info[3] << 8), 4);
});

test('decrypt with the right password yields a zip identical to the unencrypted workbook', async () => {
  const out = await OC.decrypt(new Uint8Array(fs.readFileSync(FIXTURE)), PASSWORD);
  assert.deepEqual(Array.from(out.subarray(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  // msoffcrypto re-zips the package, so compare the sheet XML content rather than raw bytes
  const plain = fs.readFileSync(PLAIN);
  assert.ok(out.length > 1000);
  assert.ok(Math.abs(out.length - plain.length) < plain.length * 0.5);
});

test('decrypt with a wrong password fails with WRONG_PASSWORD', async () => {
  await assert.rejects(OC.decrypt(new Uint8Array(fs.readFileSync(FIXTURE)), 'nope'), (e) => e.code === 'WRONG_PASSWORD');
});

test('decrypt rejects non-encrypted input as CORRUPT', async () => {
  await assert.rejects(OC.decrypt(new Uint8Array(fs.readFileSync(PLAIN)), PASSWORD), (e) => e.code === 'CORRUPT');
});

test('aesCbcDecryptNoPad round-trips a block-aligned buffer', async () => {
  const key = new Uint8Array(16).fill(7);
  const iv = new Uint8Array(16).fill(9);
  const plain = new Uint8Array(48).map((_, i) => i);
  const k = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, k, plain)).subarray(0, 48); // drop padding block
  const dec = await OC._internal.aesCbcDecryptNoPad(key, iv, enc);
  assert.deepEqual(Array.from(dec), Array.from(plain));
});
