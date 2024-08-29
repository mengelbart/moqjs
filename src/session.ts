import { ControlStream } from "./control_stream";
import { ControlStreamDecoder, ObjectStreamDecoder } from "./decoder";
import { Encoder } from "./encoder";
import {
  FilterType,
  MessageType,
  AnnounceEncoder,
  AnnounceOkEncoder,
  SubscribeEncoder,
  SubscribeOkEncoder,
  SubscribeErrorEncoder,
  UnsubscribeEncoder,
  SubscribeDoneEncoder,
  ObjectStreamEncoder,
} from "./messages";
import { Subscription } from "./subscription";
import type { Message, ObjectMsg } from "./messages";
import type { varint } from "./varint";

// so that tsup doesn't complain when producing the ts declaration file
type WebTransportReceiveStream = any;

function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export class Session {
  conn: WebTransport;
  controlStream: ControlStream;
  subscriptions: Map<varint, Subscription>;
  nextSubscribeId: number = 0;

  private _canWrite: boolean = false; // flag for publisher session

  constructor(conn: WebTransport, cs: ControlStream) {
    this.subscriptions = new Map<varint, Subscription>();

    this.conn = conn;
    this.controlStream = cs;
    cs.onmessage = this.handle.bind(this);

    this.controlStream.runReadLoop();
    this.readIncomingUnidirectionalStreams(this.conn);
  }

  static async connect(url: string, serverCertificateHash?: string) {
    console.log("connecting WebTransport");
    let conn: WebTransport;
    try {
      if (serverCertificateHash !== undefined) {
        const certHashes = [
          {
            algorithm: "sha-256",
            value: base64ToArrayBuffer(serverCertificateHash),
          },
        ];
        console.log("hashes", certHashes);
        console.log("url", url);
        conn = new WebTransport(url, { serverCertificateHashes: certHashes });
      } else {
        console.log("connecting without serverCertificateHashes");
        conn = new WebTransport(url);
      }
    } catch (error) {
      throw new Error(`failed to connect MoQ session: ${error}`);
    }
    await conn.ready;
    console.log("WebTransport connection ready");

    const cs = await conn.createBidirectionalStream();
    const decoderStream = new ReadableStream(
      new ControlStreamDecoder(cs.readable),
    );
    const encoderStream = new WritableStream(new Encoder(cs.writable));
    const controlStream = new ControlStream(decoderStream, encoderStream);
    await controlStream.handshake();
    console.log("handshake done");
    return new Session(conn, controlStream);
  }

  async readIncomingUnidirectionalStreams(conn: WebTransport) {
    console.log("reading incoming obj streams");
    const uds = conn.incomingUnidirectionalStreams;
    const reader = uds.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      this.readIncomingUniStream(value);
    }
  }

  // @ts-ignore
  async readIncomingUniStream(stream: WebTransportReceiveStream) {
    console.log("got stream");
    const messageStream = new ReadableStream<ObjectMsg>(
      new ObjectStreamDecoder(stream),
    );
    const reader = messageStream.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        console.log("stream closed");
        break;
      }
      // console.log("got object", value);
      if (!this.subscriptions.has(value.subscribeId)) {
        throw new Error(
          `got object for unknown subscribeId: ${value.subscribeId}`,
        );
      }
      // console.log(
      //   "writing to subscription",
      //   this.subscriptions.get(value.subscribeId)
      // );
      const writer = this.subscriptions
        .get(value.subscribeId)!
        .subscription.writable.getWriter();
      await writer.write(value);
      writer.releaseLock();
    }
  }

  async handle(m: Message) {
    switch (m.type) {
      case MessageType.SubscribeOk:
        this.subscriptions.get(m.subscribeId)?.subscribeOk();
    }
  }

  async announce(namespace: string) {
    await this.controlStream.send(
      new AnnounceEncoder({
        type: MessageType.Announce,
        namespace: namespace,
        parameters: [],
      }),
    );
    this._canWrite = true;
  }

  async announceOk(namespace: string) {
    await this.controlStream.send(
      new AnnounceOkEncoder({
        type: MessageType.AnnounceOk,
        trackNamespace: namespace,
      }),
    );
  }

  async subscribe(
    namespace: string,
    track: string,
  ): Promise<{ subscribeId: number; readableStream: ReadableStream }> {
    const subId = this.nextSubscribeId++;
    const s = new Subscription(subId);
    this.subscriptions.set(subId, s);
    await this.controlStream.send(
      new SubscribeEncoder({
        type: MessageType.Subscribe,
        subscribeId: subId,
        trackAlias: subId,
        trackNamespace: namespace,
        trackName: track,
        subscriberPriority: 0,
        groupOrder: 1,
        filterType: FilterType.LatestGroup,
        subscribeParameters: [],
      }),
    );
    const readableStream = await s.getReadableStream();
    return {
      subscribeId: subId,
      readableStream,
    };
  }

  async subscribeOk(
    subscribeId: number,
    expires: number,
    groupOrder: number,
    contentExists: boolean,
  ) {
    await this.controlStream.send(
      new SubscribeOkEncoder({
        type: MessageType.SubscribeOk,
        subscribeId: subscribeId,
        expires: expires,
        groupOrder: groupOrder,
        contentExists: contentExists,
      }),
    );
  }

  async subscribeError(
    subscribeId: number,
    errorCode: number,
    reasonPhrase: string,
    trackAlias: number,
  ) {
    await this.controlStream.send(
      new SubscribeErrorEncoder({
        type: MessageType.SubscribeError,
        subscribeId: subscribeId,
        errorCode: errorCode,
        reasonPhrase: reasonPhrase,
        trackAlias: trackAlias,
      }),
    );
  }

  async unsubscribe(subscribeId: number) {
    this.controlStream.send(
      new UnsubscribeEncoder({
        type: MessageType.Unsubscribe,
        subscribeId: subscribeId,
      }),
    );
  }

  async subscribeDone(
    subscribeId: number,
    statusCode: number,
    reasonPhrase: string,
    contentExists: boolean,
    finalGroup?: number,
    finalObject?: number,
  ) {
    this.controlStream.send(
      new SubscribeDoneEncoder({
        type: MessageType.SubscribeDone,
        subscribeId: subscribeId,
        statusCode: statusCode,
        reasonPhrase: reasonPhrase,
        contentExists: contentExists,
        finalGroup: finalGroup,
        finalObject: finalObject,
      }),
    );
  }

  async writeObjUniStream(
    subscribeId: number,
    trackAlias: number,
    groupId: number,
    objectId: number,
    publisherPriority: number,
    objectStatus: number,
    objectPayload: Uint8Array,
  ) {
    if (!this._canWrite) {
      throw new Error("only publisher can write to stream");
    }
    const objectStream = await this.conn.createUnidirectionalStream();
    const writer = objectStream.getWriter();
    await writer.write(
      new ObjectStreamEncoder({
        type: MessageType.ObjectStream,
        subscribeId: subscribeId,
        trackAlias: trackAlias,
        groupId: groupId,
        objectId: objectId,
        publisherPriority: publisherPriority,
        objectStatus: objectStatus,
        objectPayload: objectPayload,
      }),
    );
    await objectStream.close();
  }
}
