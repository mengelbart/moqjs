import type { varint } from "./varint";

export const DRAFT_IETF_MOQ_TRANSPORT_01 = 0xff000001;
export const DRAFT_IETF_MOQ_TRANSPORT_02 = 0xff000002;
export const DRAFT_IETF_MOQ_TRANSPORT_03 = 0xff000003;
export const DRAFT_IETF_MOQ_TRANSPORT_04 = 0xff000004;
export const DRAFT_IETF_MOQ_TRANSPORT_05 = 0xff000005;
export const CURRENT_SUPPORTED_DRAFT = DRAFT_IETF_MOQ_TRANSPORT_05;

export interface MessageEncoder {
  encode(e: Encoder): Promise<void>;
}

interface Encoder {
  writeVarint(i: varint): Promise<void>;
  writeBytes(b: Uint8Array): Promise<void>;
  writeString(s: string): Promise<void>;
}

export enum MessageType {
  ObjectStream = 0x00,
  ObjectDatagram = 0x01,
  SubscribeUpdate = 0x02,
  Subscribe = 0x03,
  SubscribeOk = 0x04,
  SubscribeError = 0x05,
  Announce = 0x06,
  AnnounceOk = 0x07,
  AnnounceError = 0x08,
  Unannounce = 0x09,
  Unsubscribe = 0x0a,
  SubscribeDone = 0x0b,
  AnnounceCancel = 0x0c,
  GoAway = 0x10,
  ClientSetup = 0x40,
  ServerSetup = 0x41,
  StreamHeaderTrack = 0x50,
  StreamHeaderGroup = 0x51,
}

export type Message =
  | ObjectMsg
  | SubscribeUpdate
  | Subscribe
  | SubscribeOk
  | SubscribeError
  | Announce
  | AnnounceOk
  | AnnounceError
  | Unannounce
  | Unsubscribe
  | SubscribeDone
  | AnnounceCancel
  | GoAway
  | ClientSetup
  | ServerSetup
  | StreamHeaderTrack
  | StreamHeaderGroup;

export interface ObjectMsg {
  type:
    | MessageType.ObjectStream
    | MessageType.ObjectDatagram
    | MessageType.StreamHeaderTrack
    | MessageType.StreamHeaderGroup;
  subscribeId: varint;
  trackAlias: varint;
  groupId: varint;
  objectId: varint;
  publisherPriority: number;
  objectStatus: varint;
  objectPayload: Uint8Array;
}

export interface ObjectStreamEncoder extends ObjectMsg {}

export class ObjectStreamEncoder implements ObjectMsg, MessageEncoder {
  constructor(m: ObjectMsg) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    if (this.type === MessageType.ObjectStream || this.type === MessageType.ObjectDatagram) {
      await e.writeVarint(this.type);
      await e.writeVarint(this.subscribeId);
      await e.writeVarint(this.trackAlias);
      await e.writeVarint(this.groupId);
      await e.writeVarint(this.objectId);
      await e.writeBytes(new Uint8Array([this.publisherPriority]));
      await e.writeVarint(this.objectStatus);
      await e.writeBytes(this.objectPayload);
      return;
    }
    if (this.type === MessageType.StreamHeaderTrack) {
      await e.writeVarint(this.groupId);
      await e.writeVarint(this.objectId);
      await e.writeVarint(this.objectPayload.length);
      if (this.objectPayload.length === 0) {
        await e.writeVarint(this.objectStatus);
        return;
      }
      await e.writeBytes(this.objectPayload);
      return;
    }
    if (this.type === MessageType.StreamHeaderGroup) {
      await e.writeVarint(this.objectId);
      await e.writeVarint(this.objectPayload.length);
      if (this.objectPayload.length === 0) {
        await e.writeVarint(this.objectStatus);
        return;
      }
      await e.writeBytes(this.objectPayload);
      return;
    }
    throw new Error(`cannot encode unknown message type ${this.type}`);
  }
}

export enum FilterType {
  LatestGroup = 0x01,
  LatestObject = 0x02,
  AbsoluteStart = 0x03,
  AbsoluteRange = 0x04,
}

export interface Subscribe {
  type: MessageType.Subscribe;
  subscribeId: varint;
  trackAlias: varint;
  trackNamespace: string;
  trackName: string;
  subscriberPriority: number;
  groupOrder: number;
  filterType: varint;
  startGroup?: varint;
  startObject?: varint;
  endGroup?: varint;
  endObject?: varint;
  subscribeParameters: Parameter[];
}

export interface SubscribeEncoder extends Subscribe {}

export class SubscribeEncoder implements Subscribe, MessageEncoder {
  constructor(m: Subscribe) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeVarint(this.subscribeId);
    await e.writeVarint(this.trackAlias);
    await e.writeString(this.trackNamespace);
    await e.writeString(this.trackName);
    await e.writeBytes(new Uint8Array([this.subscriberPriority]));
    await e.writeBytes(new Uint8Array([this.groupOrder]));
    await e.writeVarint(this.filterType);
    if (
      this.filterType === FilterType.AbsoluteStart ||
      this.filterType === FilterType.AbsoluteRange
    ) {
      await e.writeVarint(this.startGroup || 0);
      await e.writeVarint(this.startObject || 0);
    }
    if (this.filterType === FilterType.AbsoluteRange) {
      await e.writeVarint(this.endGroup || 0);
      await e.writeVarint(this.endObject || 0);
    }
    await e.writeVarint(this.subscribeParameters.length);
    for (const p of this.subscribeParameters) {
      await new ParameterEncoder(p).encode(e);
    }
  }
}

export interface SubscribeUpdate {
  type: MessageType.SubscribeUpdate;
  subscribeId: varint;
  startGroup: varint;
  startObject: varint;
  endGroup: varint;
  endObject: varint;
  subscriberPriority: number;
  subscribeParameters: Parameter[];
}

export interface SubscribeUpdateEncoder extends SubscribeUpdate {}

export class SubscribeUpdateEncoder implements SubscribeUpdate, MessageEncoder {
  constructor(m: SubscribeUpdate) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeVarint(this.subscribeId);
    await e.writeVarint(this.startGroup);
    await e.writeVarint(this.startObject);
    await e.writeVarint(this.endGroup);
    await e.writeVarint(this.endObject);
    await e.writeBytes(new Uint8Array([this.subscriberPriority]));
    await e.writeVarint(this.subscribeParameters.length);
    for (const p of this.subscribeParameters) {
      await new ParameterEncoder(p).encode(e);
    }
  }
}

export interface SubscribeOk {
  type: MessageType.SubscribeOk;
  subscribeId: varint;
  expires: varint;
  groupOrder: number;
  contentExists: boolean;
  finalGroup?: varint;
  finalObject?: varint;
}

export interface SubscribeOkEncoder extends SubscribeOk {}

export class SubscribeOkEncoder implements SubscribeOk, MessageEncoder {
  constructor(m: SubscribeOk) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeVarint(this.subscribeId);
    await e.writeVarint(this.expires);
    await e.writeBytes(new Uint8Array([this.groupOrder]));
    await e.writeVarint(this.contentExists ? 1 : 0); // TODO: Should use byte instead of varint?
    if (this.contentExists) {
      await e.writeVarint(this.finalGroup!);
      await e.writeVarint(this.finalObject!);
    }
  }
}

export interface SubscribeError {
  type: MessageType.SubscribeError;
  subscribeId: varint;
  errorCode: varint;
  reasonPhrase: string;
  trackAlias: varint;
}

export interface SubscribeErrorEncoder extends SubscribeError {}

export class SubscribeErrorEncoder implements SubscribeError, MessageEncoder {
  constructor(m: SubscribeError) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeVarint(this.subscribeId);
    await e.writeVarint(this.errorCode);
    await e.writeString(this.reasonPhrase);
    await e.writeVarint(this.trackAlias);
  }
}

export interface Unsubscribe {
  type: MessageType.Unsubscribe;
  subscribeId: varint;
}

export interface UnsubscribeEncoder extends Unsubscribe {}

export class UnsubscribeEncoder implements Unsubscribe, MessageEncoder {
  constructor(m: Unsubscribe) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeVarint(this.subscribeId);
  }
}

export interface SubscribeDone {
  type: MessageType.SubscribeDone;
  subscribeId: varint;
  statusCode: varint;
  reasonPhrase: string;
  contentExists: boolean;
  finalGroup?: varint;
  finalObject?: varint;
}

export interface SubscribeDoneEncoder extends SubscribeDone {}

export class SubscribeDoneEncoder implements SubscribeDone, MessageEncoder {
  constructor(m: SubscribeDone) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeVarint(this.subscribeId);
    await e.writeVarint(this.statusCode);
    await e.writeString(this.reasonPhrase);
    await e.writeVarint(this.contentExists ? 1 : 0); // TODO: Should use byte instead of varint?
    if (this.contentExists) {
      await e.writeVarint(this.finalGroup || 0);
      await e.writeVarint(this.finalObject || 0);
    }
  }
}

export interface Announce {
  type: MessageType.Announce;
  namespace: string;
  parameters: Parameter[];
}

export interface AnnounceEncoder extends Announce {}

export class AnnounceEncoder implements Announce, MessageEncoder {
  constructor(m: Announce) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeString(this.namespace);
    await e.writeVarint(this.parameters.length);
    for (const p of this.parameters) {
      await new ParameterEncoder(p).encode(e);
    }
  }
}

export interface AnnounceOk {
  type: MessageType.AnnounceOk;
  trackNamespace: string;
}

export interface AnnounceOkEncoder extends AnnounceOk {}

export class AnnounceOkEncoder implements AnnounceOk, MessageEncoder {
  constructor(m: AnnounceOk) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeString(this.trackNamespace);
  }
}

export interface AnnounceError {
  type: MessageType.AnnounceError;
  trackNamespace: string;
  errorCode: varint;
  reasonPhrase: string;
}

export interface AnnounceErrorEncoder extends AnnounceError {}

export class AnnounceErrorEncoder implements AnnounceError, MessageEncoder {
  constructor(m: AnnounceError) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeString(this.trackNamespace);
    await e.writeVarint(this.errorCode);
    await e.writeString(this.reasonPhrase);
  }
}

export interface Unannounce {
  type: MessageType.Unannounce;
  trackNamespace: string;
}

export interface UnannounceEncoder extends Unannounce {}

export class UnannounceEncoder implements Unannounce, MessageEncoder {
  constructor(m: Unannounce) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeString(this.trackNamespace);
  }
}

export interface AnnounceCancel {
  type: MessageType.AnnounceCancel;
}

export interface GoAway {
  type: MessageType.GoAway;
  newSessionURI: string;
}

export interface GoAwayEncoder extends GoAway {}

export class GoAwayEncoder implements GoAway, MessageEncoder {
  constructor(m: GoAway) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeString(this.newSessionURI);
  }
}

export interface ClientSetup {
  type: MessageType.ClientSetup;
  versions: varint[];
  parameters: Parameter[];
}

export interface ClientSetupEncoder extends ClientSetup {}

export class ClientSetupEncoder implements ClientSetup, MessageEncoder {
  constructor(cs: ClientSetup) {
    Object.assign(this, cs);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeVarint(this.versions.length);
    for (const v of this.versions) {
      await e.writeVarint(v);
    }
    await e.writeVarint(this.parameters.length);
    for (const p of this.parameters) {
      await new ParameterEncoder(p).encode(e);
    }
  }
}

export interface ServerSetup {
  type: MessageType.ServerSetup;
  selectedVersion: varint;
  parameters: Parameter[];
}

export interface ServerSetupEncoder extends ServerSetup {}

export class ServerSetupEncoder implements ServerSetup {
  constructor(m: ServerSetup) {
    Object.assign(this, m);
  }
}

export interface StreamHeaderTrack {
  type: MessageType.StreamHeaderTrack;
  subscribeId: varint;
  trackAlias: varint;
  publisherPriority: number;
}

export interface StreamHeaderTrackEncoder extends StreamHeaderTrack {}

export class StreamHeaderTrackEncoder
  implements StreamHeaderTrack, MessageEncoder
{
  constructor(m: StreamHeaderTrack) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeVarint(this.subscribeId);
    await e.writeVarint(this.trackAlias);
    await e.writeBytes(new Uint8Array([this.publisherPriority]));
  }
}

export interface StreamHeaderTrackObject {
  groupId: varint;
  objectId: varint;
  objectStatus?: varint;
  objectPayload: Uint8Array;
}

export interface StreamHeaderTrackObjectEncoder
  extends StreamHeaderTrackObject {}

export class StreamHeaderTrackObjectEncoder
  implements StreamHeaderTrackObject, MessageEncoder
{
  constructor(m: StreamHeaderTrackObject) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.groupId);
    await e.writeVarint(this.objectId);
    await e.writeVarint(this.objectPayload.byteLength);
    if (this.objectPayload.byteLength === 0) {
      await e.writeVarint(this.objectStatus || 0);
    } else {
      await e.writeBytes(this.objectPayload);
    }
  }
}

export interface StreamHeaderGroup {
  type: MessageType.StreamHeaderGroup;
  subscribeId: varint;
  trackAlias: varint;
  groupId: varint;
  publisherPriority: number;
}

export interface StreamHeaderGroupEncoder extends StreamHeaderGroup {}

export class StreamHeaderGroupEncoder
  implements StreamHeaderGroup, MessageEncoder
{
  constructor(m: StreamHeaderGroup) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeVarint(this.subscribeId);
    await e.writeVarint(this.trackAlias);
    await e.writeVarint(this.groupId);
    await e.writeBytes(new Uint8Array([this.publisherPriority]));
  }
}

export interface StreamHeaderGroupObject {
  objectId: varint;
  objectStatus?: varint;
  objectPayload: Uint8Array;
}

export interface StreamHeaderGroupObjectEncoder
  extends StreamHeaderGroupObject {}

export class StreamHeaderGroupObjectEncoder
  implements StreamHeaderGroupObject, MessageEncoder
{
  constructor(m: StreamHeaderGroupObject) {
    Object.assign(this, m);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.objectId);
    await e.writeVarint(this.objectPayload.byteLength);
    if (this.objectPayload.byteLength === 0) {
      await e.writeVarint(this.objectStatus || 0);
    } else {
      await e.writeBytes(this.objectPayload);
    }
  }
}

export interface Parameter {
  type: varint;
  value: Uint8Array;
}

export interface ParameterEncoder extends Parameter {}

export class ParameterEncoder implements Parameter, MessageEncoder {
  constructor(p: Parameter) {
    Object.assign(this, p);
  }

  async encode(e: Encoder): Promise<void> {
    await e.writeVarint(this.type);
    await e.writeVarint(this.value.byteLength);
    await e.writeBytes(this.value);
  }
}
