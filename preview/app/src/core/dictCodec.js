/**
 * core/dictCodec.js — Encode/decode dictionary files for in-game use.
 *
 * The on-disk format is gzip(text) XOR-ed with a repeating key. This:
 *   - Compresses the dictionary (~7 MB plain → ~1.7 MB encoded).
 *   - Prevents trivial `curl` of the asset from revealing the word list.
 *
 * It is **obfuscation, not encryption**. The key lives in this file so anyone
 * with access to the JS source can recover the dictionary. The point is to
 * stop casual scraping / direct text reads, not adversarial attackers.
 *
 * APIs used (CompressionStream / DecompressionStream / Blob / TextEncoder)
 * are standard in browsers and in Node 18+, so the same module works from
 * the app, the service worker, the build script and tests.
 */

const KEY = "letterloom-dict";
const KEY_BYTES = new TextEncoder().encode(KEY);

function xorInPlace(bytes) {
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] ^= KEY_BYTES[i % KEY_BYTES.length];
  }
  return bytes;
}

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function ungzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Encode a plain-text dictionary string into the binary on-disk format.
 * @param {string} text
 * @returns {Promise<Uint8Array>}
 */
export async function encodeDict(text) {
  const utf8 = new TextEncoder().encode(text);
  const compressed = await gzip(utf8);
  // Copy so we don't mutate the gzip result (some platforms reuse buffers).
  const buf = new Uint8Array(compressed);
  xorInPlace(buf);
  return buf;
}

/**
 * Decode an encoded dictionary back into its plain-text form.
 * @param {ArrayBuffer | Uint8Array} input
 * @returns {Promise<string>}
 */
export async function decodeDict(input) {
  const view = input instanceof Uint8Array
    ? new Uint8Array(input) // copy
    : new Uint8Array(input.slice(0));
  xorInPlace(view);
  const inflated = await ungzip(view);
  return new TextDecoder("utf-8").decode(inflated);
}
