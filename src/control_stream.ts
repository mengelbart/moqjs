import {
  CURRENT_SUPPORTED_DRAFT,
  ClientSetupEncoder,
  MessageType,
  ParameterEncoder,
} from "./messages";
import type { Message, MessageEncoder } from "./messages";

export class ControlStream {
  reader: ReadableStream<Message>;
  writer: WritableStream<MessageEncoder>;
  onmessage?: (m: Message) => {};

  constructor(r: ReadableStream<Message>, w: WritableStream<MessageEncoder>) {
    this.reader = r;
    this.writer = w;
  }

  async handshake() {
    const writer = this.writer.getWriter();
    await writer.write(
      new ClientSetupEncoder({
        type: MessageType.ClientSetup,
        versions: [CURRENT_SUPPORTED_DRAFT],
        parameters: [
          new ParameterEncoder({ type: 0, value: new Uint8Array([0x2]) }),
        ],
      }),
    );
    writer.releaseLock();

    const reader = this.reader.getReader();
    const { value, done } = await reader.read();
    if (done) {
      throw new Error("control stream closed");
    }
    if (value.type != MessageType.ServerSetup) {
      throw new Error("invalid first message on control stream");
    }
    // TODO: Evaluate server setup message?
    reader.releaseLock();
  }

  async runReadLoop() {
    const reader = this.reader.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        console.log("control stream closed");
        break;
      }
      if (this.onmessage) {
        this.onmessage(value);
      }
    }
  }

  async send(m: MessageEncoder) {
    const writer = this.writer.getWriter();
    await writer.write(m);
    writer.releaseLock();
  }
}
