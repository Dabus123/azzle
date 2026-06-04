import { ethers } from "ethers";
import type { AzzleClient } from "../client.js";
import type { TaskTerms } from "../types.js";
import { linkIdentity } from "./identity.js";
import { NegotiationHandlers, type AgentRole } from "./handlers.js";
import { ChainEventIndexer } from "./correlation.js";
import {
  createNegotiationTransport,
  type XmtpNegotiationTransport,
  type XmtpTransportOptions,
} from "./transport.js";

export interface AgentStartupConfig {
  evmSigner: ethers.Signer;
  azzle: AzzleClient;
  role: AgentRole;
  terms: TaskTerms;
  counterpartyEvm: string;
  rpcUrl: string;
  registryAddress: string;
  escrowAddress: string;
  arbitrationAddress?: string;
  transportOptions?: XmtpTransportOptions;
}

export interface StartedAgent {
  transport: XmtpNegotiationTransport;
  handlers: NegotiationHandlers;
  indexer: ChainEventIndexer;
}

/** Create XMTP client, link identity, wire handlers and on-chain event correlation. */
export async function startAgent(config: AgentStartupConfig): Promise<StartedAgent> {
  const transport = await createNegotiationTransport(config.evmSigner, {
    ...config.transportOptions,
    counterpartyEvm: config.counterpartyEvm,
  });

  await linkIdentity(config.evmSigner, transport.xmtpClient, async (link) => {
    await transport.publishIdentityLink(link, config.counterpartyEvm);
  });

  await transport.connectCounterparty(config.counterpartyEvm);

  const network = await config.evmSigner.provider?.getNetwork();
  const chainId = network?.chainId ?? 31337n;

  const handlers = new NegotiationHandlers({
    transport,
    azzle: config.azzle,
    evmSigner: config.evmSigner,
    role: config.role,
    terms: config.terms,
    chainId,
    counterpartyEvm: config.counterpartyEvm,
  });

  transport.subscribe((envelope) => handlers.handle(envelope));

  const indexer = new ChainEventIndexer({
    rpcUrl: config.rpcUrl,
    registryAddress: config.registryAddress,
    escrowAddress: config.escrowAddress,
    arbitrationAddress: config.arbitrationAddress,
    transport,
  });
  await indexer.start();

  return { transport, handlers, indexer };
}
