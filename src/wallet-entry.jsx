import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { base } from "viem/chains";
import { createPosterApi } from "./azzle-chain.js";

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr ?? "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function emitWallet(address) {
  window.dispatchEvent(
    new CustomEvent("azzle-wallet-change", {
      detail: { address: address ?? null, chainId: base.id },
    })
  );
}

function pickWallet(wallets) {
  return (
    wallets.find((w) => w.walletClientType !== "privy" && w.chainId === `eip155:${base.id}`) ??
    wallets.find((w) => w.walletClientType !== "privy") ??
    wallets[0] ??
    null
  );
}

function PosterBridge() {
  const { ready, authenticated, logout } = usePrivy();
  const { wallets } = useWallets();
  const wallet = pickWallet(wallets);

  useEffect(() => {
    window.azzleLogout = authenticated ? () => logout() : null;
    return () => {
      window.azzleLogout = null;
    };
  }, [authenticated, logout]);

  useEffect(() => {
    window.azzlePoster = createPosterApi({
      ready,
      authenticated,
      wallet: authenticated ? wallet : null,
    });
    window.dispatchEvent(new Event("azzle-poster-ready"));
  }, [ready, authenticated, wallet]);

  return null;
}

function WalletControlsUnconfigured() {
  return (
    <button
      type="button"
      className="rd-wallet-btn rd-wallet-btn--off"
      disabled
      title="Set PRIVY_APP_ID in Vercel env (or azzle-force/.env locally)"
    >
      Sign in
    </button>
  );
}

function WalletControlsInner() {
  const { ready, authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();

  const address =
    pickWallet(wallets)?.address ?? user?.wallet?.address ?? null;

  useEffect(() => {
    if (!ready) return;
    emitWallet(authenticated ? address : null);
  }, [ready, authenticated, address]);

  if (!ready) {
    return (
      <button type="button" className="rd-wallet-btn rd-wallet-btn--off" disabled>
        …
      </button>
    );
  }

  if (authenticated && address) {
    return (
      <a
        href="/wallet"
        className="rd-wallet-btn rd-wallet-btn--on"
        title={"Wallet on Base · " + address + " · click to open"}
      >
        {shortAddr(address)}
      </a>
    );
  }

  return (
    <button type="button" className="rd-wallet-btn" onClick={() => login()}>
      Sign in
    </button>
  );
}

function WalletApp({ appId, clientId }) {
  const configured = Boolean(appId);

  if (!configured) {
    return <WalletControlsUnconfigured />;
  }

  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId || undefined}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "light",
          accentColor: "#00c896",
          showWalletLoginFirst: false,
        },
        defaultChain: base,
        supportedChains: [base],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          showWalletUIs: false,
        },
      }}
    >
      <PosterBridge />
      <WalletControlsInner />
    </PrivyProvider>
  );
}

async function boot() {
  const mounts = document.querySelectorAll("[data-rd-wallet-mount]");
  if (!mounts.length) return;

  let appId = "";
  let clientId = "";
  try {
    const res = await fetch("/api/site-config", { cache: "no-store" });
    if (res.ok) {
      const cfg = await res.json();
      appId = cfg.privyAppId ?? "";
      clientId = cfg.privyClientId ?? "";
    }
  } catch {
    /* offline / file:// */
  }

  mounts.forEach((el) => {
    createRoot(el).render(<WalletApp appId={appId} clientId={clientId} />);
  });
}

boot();
