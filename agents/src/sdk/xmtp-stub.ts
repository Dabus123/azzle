/**
 * @deprecated Import from `./xmtp/index.js` instead.
 * This module re-exports the real XMTP transport for backward-compatible paths.
 */
export {
  XmtpNegotiationTransport,
  createNegotiationTransport,
  startAgent,
  linkIdentity,
  NegotiationHandlers,
  ChainEventIndexer,
} from "./xmtp/index.js";

export { NegotiationBus } from "./xmtp-local-bus.js";
