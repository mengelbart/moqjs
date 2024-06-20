import { encodeVarint } from "./varint";
import type { varint } from "./varint";
import type { MessageEncoder } from "./messages";

export class Encoder {
  writer: WritableStream<Uint8Array>;

  constructor(stream: WritableStream<Uint8Array>) {
    this.writer = stream;
  }

  async write(
    chunk: MessageEncoder,
    _: WritableStreamDefaultController,
  ): Promise<void> {
    await chunk.encode(this);
  }

  async writeVarint(i: varint): Promise<void> {
    const data = encodeVarint(i);
    const writer = this.writer.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  async writeBytes(data: Uint8Array): Promise<void> {
    const writer = this.writer.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  async writeString(s: string): Promise<void> {
    const data = new TextEncoder().encode(s);
    await this.writeVarint(data.byteLength);
    await this.writeBytes(data);
  }
}
