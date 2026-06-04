import { ethers } from "ethers";
import type { Client } from "@xmtp/node-sdk";
import type { IdentityLink } from "./types.js";
import { IDENTITY_LINK_TYPE } from "./types.js";
import { installationPublicKey } from "./signer.js";
import { validatePayload } from "./validation.js";

export function buildIdentityLinkDigest(
  link: Pick<IdentityLink, "xmtpPublicKey" | "evmAddress" | "issuedAt">
): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["string", "address", "string"],
      [link.xmtpPublicKey, link.evmAddress, link.issuedAt]
    )
  );
}

export async function signIdentityLink(
  signer: ethers.Signer,
  link: Pick<IdentityLink, "xmtpPublicKey" | "evmAddress" | "issuedAt">
): Promise<IdentityLink> {
  const digest = buildIdentityLinkDigest(link);
  const signature = await signer.signMessage(ethers.getBytes(digest));
  return { ...link, type: IDENTITY_LINK_TYPE, signature };
}

export function verifyIdentityLink(link: IdentityLink): boolean {
  validatePayload("IdentityLink", link);
  const digest = buildIdentityLinkDigest(link);
  const recovered = ethers.verifyMessage(ethers.getBytes(digest), link.signature);
  return recovered.toLowerCase() === link.evmAddress.toLowerCase();
}

export async function buildIdentityLink(
  signer: ethers.Signer,
  xmtpClient: Client
): Promise<IdentityLink> {
  const evmAddress = (await signer.getAddress()).toLowerCase();
  const draft: Omit<IdentityLink, "signature" | "type"> = {
    xmtpPublicKey: installationPublicKey(xmtpClient),
    evmAddress,
    issuedAt: new Date().toISOString(),
  };
  return signIdentityLink(signer, draft);
}

/** Sign and publish IdentityLink to a counterparty DM before negotiation. */
export async function linkIdentity(
  signer: ethers.Signer,
  xmtpClient: Client,
  publish: (link: IdentityLink) => Promise<void>
): Promise<IdentityLink> {
  const link = await buildIdentityLink(signer, xmtpClient);
  await publish(link);
  return link;
}
