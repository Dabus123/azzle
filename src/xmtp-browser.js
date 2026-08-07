import { Client, IdentifierKind } from "@xmtp/browser-sdk";

function hexToBytes(hex) {
  const normalized = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function assertAddress(address, label) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address ?? "")) {
    throw new Error(`A valid ${label} address is required for XMTP.`);
  }
  return address;
}

export async function sendDeliveryNotice({ wallet, poster, notice }) {
  const posterAddress = assertAddress(poster, "poster");
  const workerAddress = assertAddress(wallet?.address, "worker");
  if (!notice?.taskId || !notice?.receiptHash) {
    throw new Error("Delivery notice requires a task ID and receipt hash.");
  }

  const provider = await wallet.getEthereumProvider();
  const signer = {
    type: "EOA",
    getIdentifier: () => ({
      identifier: workerAddress,
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message) => {
      const signature = await provider.request({
        method: "personal_sign",
        params: [message, workerAddress],
      });
      return hexToBytes(signature);
    },
  };
  const client = await Client.create(signer, {
    env: "production",
    appVersion: "azzle.org/worker-delivery-1",
  });

  try {
    const conversation = await client.conversations.createDmWithIdentifier({
      identifier: posterAddress,
      identifierKind: IdentifierKind.Ethereum,
    });
    const messageId = await conversation.sendText(JSON.stringify({
      type: "azzle/DeliveryNotice",
      taskId: String(notice.taskId),
      milestoneIndex: 0,
      receiptHash: notice.receiptHash,
      receiptUri: notice.receiptUri || undefined,
      artifactUris: notice.artifactUris,
      receipt: notice.receipt,
      summary: notice.summary,
    }));
    return { messageId, poster: posterAddress };
  } finally {
    client.close();
  }
}
