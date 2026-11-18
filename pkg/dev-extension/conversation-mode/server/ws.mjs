// conversation-api: the WebSocket the page listens on, by hand (RFC 6455).
//
// The server runs from a ConfigMap with no node_modules, like dev-api, so the few lines a server
// that only ever sends text needs are here. It reads what a browser sends only to answer a ping
// and to notice a close; anything else from the page is ignored.
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function acceptKey(key) {
  return crypto.createHash('sha1').update(`${ key }${ GUID }`).digest('base64');
}

/** One unmasked frame, as a server sends them. */
export function frame(opcode, payload = Buffer.alloc(0)) {
  const len = payload.length;
  let head;

  if (len < 126) {
    head = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([head, payload]);
}

export const textFrame = (text) => frame(0x1, Buffer.from(String(text)));

/**
 * The frames whole in `buf` (a browser's are masked), and what is left over for the next chunk.
 * @returns {{ frames: { opcode: number, payload: Buffer }[], rest: Buffer }}
 */
export function readFrames(buf) {
  const frames = [];
  let at = 0;

  while (buf.length - at >= 2) {
    const opcode = buf[at] & 0x0f;
    const masked = (buf[at + 1] & 0x80) !== 0;
    let len = buf[at + 1] & 0x7f;
    let p = at + 2;

    if (len === 126) {
      if (buf.length < p + 2) {
        break;
      }
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length < p + 8) {
        break;
      }
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    const mask = masked ? buf.subarray(p, p + 4) : null;

    p += masked ? 4 : 0;
    if (buf.length < p + len) {
      break;
    }
    const payload = Buffer.from(buf.subarray(p, p + len));

    if (mask) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }
    frames.push({ opcode, payload });
    at = p + len;
  }

  return { frames, rest: buf.subarray(at) };
}
