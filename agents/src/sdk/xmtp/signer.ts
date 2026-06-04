import { ethers } from "ethers";
import {
  Client,
  IdentifierKind,
  type Signer as XmtpSigner,
} from "@xmtp/node-sdk";
import type { ClientOptions } from "@xmtp/node-sdk";
import { getRandomValues } from "node:crypto";

export function ethersToXmtpSigner(signer: ethers.Signer): XmtpSigner {
  return {
    type: "EOA",
    getIdentifier: async () => {
      const address = await signer.getAddress();
      return {
        identifier: address.toLowerCase(),
        identifierKind: IdentifierKind.Ethereum,
      };
    },
    signMessage: async (message: string) => {
      const bytes =
        typeof message === "string"
          ? ethers.toUtf8Bytes(message)
          : new Uint8Array(message as unknown as ArrayBuffer);
      const signature = await signer.signMessage(bytes);
      return ethers.getBytes(signature);
    },
  };
}

export async function createXmtpClient(
  evmSigner: ethers.Signer,
  options?: ClientOptions
): Promise<Client> {
  const dbEncryptionKey =
    options?.dbEncryptionKey ?? getRandomValues(new Uint8Array(32));
  const client = await Client.create(ethersToXmtpSigner(evmSigner), {
    dbPath: options?.dbPath ?? null,
    dbEncryptionKey,
    ...options,
  } as ClientOptions);
  return client as Client;
}

export function installationPublicKey(client: Client): string {
  return ethers.hexlify(client.installationIdBytes);
}
