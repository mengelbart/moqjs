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
    console.log("handshaking...");
    console.log(
      "current supported draft: ",
      CURRENT_SUPPORTED_DRAFT.toString(16),
    );

    try {
      const m = new ClientSetupEncoder({
        type: MessageType.ClientSetup,
        versions: [CURRENT_SUPPORTED_DRAFT],
        parameters: [
          new ParameterEncoder({ type: 0, value: new Uint8Array([0x2]) }),
        ],
      });
      await this.send(m);
      console.log("ClientSetup msg sent");
    } catch (error) {
      console.log("failed to send ClientSetup msg: ", error);
      throw error;
    }

    const reader = this.reader.getReader();
    try {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error("control stream closed");
      }
      if (value.type != MessageType.ServerSetup) {
        throw new Error("invalid first message on control stream");
      }
      console.log("handshake msg received: ", value);
    } catch (error) {
      console.log("failed to read handshake msg: ", error);
      throw error;
    } finally {
      // TODO: Evaluate server setup message?
      reader.releaseLock();
    }
  }

  async runReadLoop() {
    const reader = this.reader.getReader();
    console.log("running cs read loop...");
    try {
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
    } catch (error) {
      console.log("err in runReadLoop: ", error);
    } finally {
      reader.releaseLock();
    }
  }

  async send(m: MessageEncoder) {
    const writer = this.writer.getWriter();
    try {
      await writer.write(m);
    } catch (error) {
      console.log("failed to send message: ", error);
    } finally {
      writer.releaseLock();
    }
  }
}
