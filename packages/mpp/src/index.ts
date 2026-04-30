/**
 * @atlasprotocol/mpp — standalone implementation of the Machine Payments Protocol
 * envelope (https://mpp.dev), with an optional JWS signing layer.
 */

export {
  encode,
  decode,
  serialize,
  deserialize,
  canonicalize,
  MPP_PROTOCOL_VERSION,
} from './envelope.js';

export { signEnvelope, verifyEnvelope } from './signer.js';

export {
  SUPPORTED_RAILS,
  isSupportedRail,
  isValidMethodIdentifier,
  METHOD_IDENTIFIER_PATTERN,
} from './rails.js';

export type {
  Rail,
  MppEnvelope,
  MppHeader,
  MppRequest,
  MppMethod,
  MppIntent,
  SignedMppEnvelope,
  MppPayload,
  MppLineItem,
  SigningAlg,
  SigningKey,
  VerificationKey,
} from './types/index.js';
