import { type varint } from "../src/varint";
import { encodeVarint } from "../src/varint";

describe('varint', () => {
  for (let i = 0; i <= 63; i++) {
    it('encodes 1-byte varints in a single byte', () => {
      const expected = new Uint8Array([i]);
      expect(encodeVarint(i)).toEqual(expected);
    })
  }

  it('encodes a 2-byte varint', () => {
    const expected = new Uint8Array([0x40, 0x40]);
    expect(encodeVarint(64)).toEqual(expected);
  });
});