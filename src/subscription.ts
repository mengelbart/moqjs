import type { Message, ObjectMsg } from "./messages";
import type { varint } from "./varint";

export class Subscription {
  id: varint;
  promise: Promise<ReadableStream>;
  resolve!: (
    value: ReadableStream<any> | PromiseLike<ReadableStream<any>>,
  ) => void;
  reject!: (reason?: any) => void;
  subscription: TransformStream<Message, Uint8Array>;

  constructor(id: varint) {
    this.id = id;
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.subscription = new TransformStream({
      transform: (
        chunk: ObjectMsg,
        controller: TransformStreamDefaultController<Uint8Array>,
      ) => {
        controller.enqueue(chunk.objectPayload);
      },
    });
  }

  subscribeOk() {
    this.resolve(this.subscription.readable);
  }

  subscribeError(reason: string) {
    this.reject(reason);
  }

  getReadableStream(): Promise<ReadableStream> {
    return this.promise;
  }
}
