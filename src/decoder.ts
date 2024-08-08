import { FilterType, MessageType } from "./messages";

import type {
  ObjectMsg,
  Subscribe,
  SubscribeOk,
  SubscribeError,
  Announce,
  AnnounceOk,
  AnnounceError,
  Unannounce,
  Unsubscribe,
  GoAway,
  ServerSetup,
  StreamHeaderTrack,
  StreamHeaderTrackObject,
  StreamHeaderGroup,
  StreamHeaderGroupObject,
  SubscribeDone,
  Parameter,
  SubscribeUpdate,
} from "./messages";

type varint = number | bigint;

enum EncoderState {
  Init,
  TrackStream,
  GroupStream,
}

class Decoder {
  reader: ReadableStream<Uint8Array>;
  buffer: Uint8Array;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream;
    this.buffer = new Uint8Array(8);
  }

  async read(
    buffer: Uint8Array,
    offset: number,
    length: number
  ): Promise<Uint8Array> {
    const reader = this.reader.getReader({ mode: "byob" });
    while (offset < length) {
      const buf = new Uint8Array(
        buffer.buffer,
        buffer.byteOffset + offset,
        length - offset
      );
      const { value, done } = await reader.read(buf);
      if (done) {
        throw new Error("stream closed");
      }
      buffer = new Uint8Array(value.buffer, value.byteOffset - offset);
      offset += value.byteLength;
    }
    reader.releaseLock();
    return buffer;
  }

  async readN(n: number): Promise<Uint8Array> {
    const buffer = new Uint8Array(n);
    const data = await this.read(buffer, 0, n);
    return data;
  }

  async readAll(): Promise<Uint8Array> {
    const reader = this.reader.getReader();
    let buffer = new Uint8Array();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const next = new Uint8Array(buffer.byteLength + value.byteLength);
      next.set(buffer);
      next.set(value, buffer.byteLength);
      buffer = next;
    }
    reader.releaseLock();
    return buffer;
  }

  async readVarint(): Promise<varint> {
    this.buffer = await this.read(this.buffer, 0, 1);
    if (this.buffer.length !== 1) {
      throw new Error("readVarint could not read first byte");
    }
    const prefix = this.buffer[0]! >> 6;
    const length = 1 << prefix;
    let view = new DataView(this.buffer.buffer, 0, length);
    switch (length) {
      case 1:
        return view.getUint8(0) & 0x3f;
      case 2:
        this.buffer = await this.read(this.buffer, 1, 2);
        view = new DataView(this.buffer.buffer, 0, length);
        return view.getUint16(0) & 0x3fff;
      case 4:
        this.buffer = await this.read(this.buffer, 1, 4);
        view = new DataView(this.buffer.buffer, 0, length);
        return view.getUint32(0) & 0x3fffffff;
      case 8:
        this.buffer = await this.read(this.buffer, 1, 8);
        view = new DataView(this.buffer.buffer, 0, length);
        return view.getBigUint64(0) & 0x3fffffffffffffffn;
    }
    throw new Error("invalid varint length");
  }

  async objectStream(): Promise<ObjectMsg> {
    return {
      type: MessageType.ObjectStream,
      subscribeId: await this.readVarint(),
      trackAlias: await this.readVarint(),
      groupId: await this.readVarint(),
      objectId: await this.readVarint(),
      publisherPriority: (await this.readN(1))[0]!,
      objectStatus: await this.readVarint(),
      objectPayload: await this.readAll(),
    };
  }

  async subscribe(): Promise<Subscribe> {
    const subscribeId = await this.readVarint();
    const trackAlias = await this.readVarint();
    const trackNamespace = await this.string();
    const trackName = await this.string();
    const subscriberPriority = (await this.readN(1))[0]!;
    const groupOrder = (await this.readN(1))[0]!;
    const filterType = await this.readVarint();
    let startGroup;
    let startObject;
    let endGroup;
    let endObject;
    if (
      filterType === FilterType.AbsoluteStart ||
      filterType == FilterType.AbsoluteRange
    ) {
      startGroup = await this.readVarint();
      startObject = await this.readVarint();
    }
    if (filterType == FilterType.AbsoluteRange) {
      endGroup = await this.readVarint();
      endObject = await this.readVarint();
    }
    return {
      type: MessageType.Subscribe,
      subscribeId,
      trackAlias,
      trackNamespace,
      trackName,
      subscriberPriority,
      groupOrder,
      filterType,
      startGroup,
      startObject,
      endGroup,
      endObject,
      subscribeParameters: await this.parameters(),
    };
  }

  async subscribeUpdate(): Promise<SubscribeUpdate> {
    const subscribeId = await this.readVarint();
    const startGroup = await this.readVarint();
    const startObject = await this.readVarint();
    const endGroup = await this.readVarint();
    const endObject = await this.readVarint();
    const subscriberPriority = (await this.readN(1))[0]!;
    return {
      type: MessageType.SubscribeUpdate,
      subscribeId,
      startGroup,
      startObject,
      endGroup,
      endObject,
      subscriberPriority,
      subscribeParameters: await this.parameters(),
    };
  }

  async subscribeOk(): Promise<SubscribeOk> {
    const subscribeId = await this.readVarint();
    const expires = await this.readVarint();
    const groupOrder = (await this.readN(1))[0]!;
    const contentExists = (await this.readVarint()) == 1;
    let finalGroup;
    let finalObject;
    if (contentExists) {
      finalGroup = await this.readVarint();
      finalObject = await this.readVarint();
    }
    return {
      type: MessageType.SubscribeOk,
      subscribeId,
      expires,
      groupOrder,
      contentExists,
      finalGroup,
      finalObject,
    };
  }

  async subscribeError(): Promise<SubscribeError> {
    return {
      type: MessageType.SubscribeError,
      subscribeId: await this.readVarint(),
      errorCode: await this.readVarint(),
      reasonPhrase: await this.string(),
      trackAlias: await this.readVarint(),
    };
  }

  async announce(): Promise<Announce> {
    return {
      type: MessageType.Announce,
      namespace: await this.string(),
      parameters: await this.parameters(),
    };
  }

  async announceOk(): Promise<AnnounceOk> {
    return {
      type: MessageType.AnnounceOk,
      trackNamespace: await this.string(),
    };
  }

  async announceError(): Promise<AnnounceError> {
    return {
      type: MessageType.AnnounceError,
      trackNamespace: await this.string(),
      errorCode: await this.readVarint(),
      reasonPhrase: await this.string(),
    };
  }

  async unannounce(): Promise<Unannounce> {
    return {
      type: MessageType.Unannounce,
      trackNamespace: await this.string(),
    };
  }

  async unsubscribe(): Promise<Unsubscribe> {
    return {
      type: MessageType.Unsubscribe,
      subscribeId: await this.readVarint(),
    };
  }

  async subscribeDone(): Promise<SubscribeDone> {
    const subscribeId = await this.readVarint();
    const statusCode = await this.readVarint();
    const reasonPhrase = await this.string();
    const contentExists = (await this.readVarint()) == 1;
    let finalGroup;
    let finalObject;
    if (contentExists) {
      finalGroup = await this.readVarint();
      finalObject = await this.readVarint();
    }
    return {
      type: MessageType.SubscribeDone,
      subscribeId,
      statusCode,
      reasonPhrase,
      contentExists,
      finalGroup,
      finalObject,
    };
  }

  async goAway(): Promise<GoAway> {
    return {
      type: MessageType.GoAway,
      newSessionURI: await this.string(),
    };
  }

  async serverSetup(): Promise<ServerSetup> {
    return {
      type: MessageType.ServerSetup,
      selectedVersion: await this.readVarint(),
      parameters: await this.parameters(),
    };
  }

  async streamHeaderTrack(): Promise<StreamHeaderTrack> {
    return {
      type: MessageType.StreamHeaderTrack,
      subscribeId: await this.readVarint(),
      trackAlias: await this.readVarint(),
      publisherPriority: (await this.readN(1))[0]!,
    };
  }

  async streamHeaderTrackObject(): Promise<StreamHeaderTrackObject> {
    const groupId = await this.readVarint();
    const objectId = await this.readVarint();
    const length = await this.readVarint();
    if (length > Number.MAX_VALUE) {
      throw new Error(
        `cannot read more then ${Number.MAX_VALUE} bytes from stream`
      );
    }
    let objectStatus;
    if (length === 0) {
      objectStatus = await this.readVarint();
    }
    return {
      groupId,
      objectId,
      objectStatus,
      objectPayload: await this.readN(<number>length),
    };
  }

  async streamHeaderGroup(): Promise<StreamHeaderGroup> {
    return {
      type: MessageType.StreamHeaderGroup,
      subscribeId: await this.readVarint(),
      trackAlias: await this.readVarint(),
      groupId: await this.readVarint(),
      publisherPriority: (await this.readN(1))[0]!,
    };
  }

  async streamHeaderGroupObject(): Promise<StreamHeaderGroupObject | null> {
    let objectId;
    try {
      // stream can be closed if the peer is done sending all objects
      objectId = await this.readVarint();
    } catch (err) {
      return null;
    }
    const length = await this.readVarint();
    if (length > Number.MAX_VALUE) {
      throw new Error(
        `cannot read more then ${Number.MAX_VALUE} bytes from stream`
      );
    }
    let objectStatus;
    if (length === 0) {
      objectStatus = await this.readVarint();
    }
    return {
      objectId: objectId,
      objectStatus,
      objectPayload: await this.readN(<number>length),
    };
  }

  async string(): Promise<string> {
    const length = await this.readVarint();
    if (length > Number.MAX_VALUE) {
      throw new Error(
        `cannot read more then ${Number.MAX_VALUE} bytes from stream`
      );
    }
    const data = await this.readN(<number>length);
    return new TextDecoder().decode(data);
  }

  async parameter(): Promise<Parameter> {
    const type = await this.readVarint();
    const length = await this.readVarint();
    if (length > Number.MAX_VALUE) {
      throw new Error(
        `cannot read more then ${Number.MAX_VALUE} bytes from stream`
      );
    }
    return {
      type: type,
      value: await this.readN(<number>length),
    };
  }

  async parameters(): Promise<Parameter[]> {
    const num = await this.readVarint();
    const parameters = [];
    for (let i = 0; i < num; i++) {
      parameters.push(await this.parameter());
    }
    return parameters;
  }
}

export class ControlStreamDecoder extends Decoder {
  async pull(controller: ReadableStreamDefaultController): Promise<void> {
    const mt = await this.readVarint();
    switch (mt) {
      case MessageType.Subscribe:
        return controller.enqueue(await this.subscribe());
      case MessageType.SubscribeUpdate:
        return controller.enqueue(await this.subscribeUpdate());
      case MessageType.SubscribeOk:
        return controller.enqueue(await this.subscribeOk());
      case MessageType.SubscribeError:
        return controller.enqueue(await this.subscribeError());
      case MessageType.Announce:
        return controller.enqueue(await this.announce());
      case MessageType.AnnounceOk:
        return controller.enqueue(await this.announceOk());
      case MessageType.AnnounceError:
        return controller.enqueue(await this.announceError());
      case MessageType.Unannounce:
        return controller.enqueue(await this.unannounce());
      case MessageType.Unsubscribe:
        return controller.enqueue(await this.unsubscribe());
      case MessageType.SubscribeDone:
        return controller.enqueue(await this.subscribeDone());
      case MessageType.GoAway:
        return controller.enqueue(await this.goAway());
      case MessageType.ServerSetup:
        return controller.enqueue(await this.serverSetup());
    }
    throw new Error(`unexpected message type: ${mt}`);
  }
}

export class ObjectStreamDecoder extends Decoder {
  state: EncoderState;
  subscribeId?: varint;
  trackAlias?: varint;
  groupId?: varint;
  publisherPriority?: number;

  constructor(stream: ReadableStream<Uint8Array>) {
    super(stream);
    this.state = EncoderState.Init;
  }

  async pull(
    controller: ReadableStreamDefaultController<ObjectMsg>
  ): Promise<void> {
    if (this.state === EncoderState.TrackStream) {
      const o = await this.streamHeaderTrackObject();
      return controller.enqueue({
        type: MessageType.StreamHeaderTrack,
        subscribeId: this.subscribeId!,
        trackAlias: this.trackAlias!,
        groupId: o.groupId,
        objectId: o.objectId,
        publisherPriority: this.publisherPriority!,
        objectStatus: 0,
        objectPayload: o.objectPayload,
      });
    }
    if (this.state === EncoderState.GroupStream) {
      const o = await this.streamHeaderGroupObject();
      if (!o) {
        controller.close();
        return;
      }
      return controller.enqueue({
        type: MessageType.StreamHeaderGroup,
        subscribeId: this.subscribeId!,
        trackAlias: this.trackAlias!,
        groupId: this.groupId!,
        objectId: o.objectId,
        publisherPriority: this.publisherPriority!,
        objectStatus: 0,
        objectPayload: o.objectPayload,
      });
    }

    const mt = await this.readVarint();
    console.log("decoding message type", mt);

    if (mt === MessageType.ObjectStream) {
      controller.enqueue(await this.objectStream());
      return controller.close();
    }

    if (mt === MessageType.StreamHeaderTrack) {
      const header = await this.streamHeaderTrack();
      this.state = EncoderState.TrackStream;
      this.subscribeId = header.subscribeId;
      this.trackAlias = header.trackAlias;
      this.publisherPriority = header.publisherPriority;
      const o = await this.streamHeaderTrackObject();
      return controller.enqueue({
        type: MessageType.StreamHeaderTrack,
        subscribeId: this.subscribeId!,
        trackAlias: this.trackAlias!,
        groupId: o.groupId,
        objectId: o.objectId,
        publisherPriority: this.publisherPriority!,
        objectStatus: 0,
        objectPayload: o.objectPayload,
      });
    }

    if (mt === MessageType.StreamHeaderGroup) {
      const header = await this.streamHeaderGroup();
      this.state = EncoderState.GroupStream;
      this.subscribeId = header.subscribeId;
      this.trackAlias = header.trackAlias;
      this.groupId = header.groupId;
      this.publisherPriority = header.publisherPriority;
      const o = await this.streamHeaderGroupObject();
      if (!o) {
        return;
      }
      return controller.enqueue({
        type: MessageType.StreamHeaderGroup,
        subscribeId: this.subscribeId!,
        trackAlias: this.trackAlias!,
        groupId: this.groupId!,
        objectId: o.objectId,
        publisherPriority: this.publisherPriority!,
        objectStatus: 0,
        objectPayload: o.objectPayload,
      });
    }
    throw new Error(`unexpected message type: ${mt}`);
  }
}
