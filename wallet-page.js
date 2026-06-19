(function () {
  "use strict";

  let walletAddress = null;
  let busy = false;
  let balances = null;

  const $ = (id) => document.getElementById(id);

  function api() {
    return window.azzlePoster ?? null;
  }

  function setStatus(text, kind) {
    const el = $("rd-wallet-status");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("busy", "ok", "err");
    if (kind) el.classList.add(kind);
  }

  function fmtUsdc(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function fmtAzl(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + "B AZL";
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M AZL";
    return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " AZL";
  }

  function fmtEth(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (v < 0.0001) return v.toExponential(2) + " ETH";
    return v.toLocaleString(undefined, { maximumFractionDigits: 6 }) + " ETH";
  }

  function renderBalances(b) {
    balances = b;
    $("rd-bal-usdc-wallet").textContent = fmtUsdc(b.usdcWallet);
    $("rd-bal-usdc-vault").textContent = fmtUsdc(b.usdcVault);
    $("rd-bal-azl").textContent = fmtAzl(b.azlWallet);
    $("rd-bal-eth").textContent = fmtEth(b.eth);

    const hint = $("rd-usdc-vault-hint");
    if (hint) {
      if (b.depositReady) {
        hint.textContent = "Ready to post · max withdraw $" + b.maxVaultWithdraw;
      } else {
        hint.textContent =
          "Deposit at least $" + b.entryDepositMin + " to post · max withdraw $" + b.maxVaultWithdraw;
      }
    }

    const withdrawInput = $("rd-usdc-withdraw-amt");
    if (withdrawInput && !withdrawInput.value) {
      withdrawInput.placeholder = "Max " + b.maxVaultWithdraw;
    }
  }

  async function refresh() {
    const grid = $("rd-wallet-grid");
    const receive = $("rd-wallet-receive");
    const poster = api();

    if (!poster?.ready) {
      setStatus("Loading wallet…");
      if (grid) grid.hidden = true;
      if (receive) receive.hidden = true;
      return;
    }

    if (!walletAddress) {
      setStatus("Sign in (top right) to view balances.");
      if (grid) grid.hidden = true;
      if (receive) receive.hidden = true;
      return;
    }

    try {
      const b = await poster.getWalletBalances();
      if (!b.configured) {
        setStatus("Server missing contract config.", "err");
        return;
      }
      renderBalances(b);
      if (grid) grid.hidden = false;
      if (receive) {
        receive.hidden = false;
        $("rd-wallet-address").textContent = b.address;
      }
      setStatus("Balances on Base · updated just now", "ok");
    } catch (e) {
      setStatus((e && e.message) || "Could not load balances", "err");
    }
  }

  async function runAction(fn) {
    if (busy) return;
    const poster = api();
    if (!walletAddress || !poster) {
      setStatus("Sign in first.", "err");
      return;
    }
    busy = true;
    setStatus("Confirm in your wallet…", "busy");
    try {
      await fn(poster, (msg) => setStatus(msg, "busy"));
      setStatus("Done — refreshing balances…", "ok");
      await refresh();
    } catch (e) {
      setStatus((e && e.message) || "Transaction failed", "err");
    } finally {
      busy = false;
    }
  }

  function init() {
    $("rd-wallet-copy")?.addEventListener("click", () => {
      if (!walletAddress) return;
      navigator.clipboard.writeText(walletAddress).then(() => {
        setStatus("Address copied.", "ok");
      });
    });

    $("rd-usdc-deposit-btn")?.addEventListener("click", () => {
      const amt = parseFloat($("rd-usdc-deposit-amt")?.value ?? "0");
      runAction((p, onProgress) => p.depositToVault(amt, onProgress));
    });

    $("rd-usdc-withdraw-max")?.addEventListener("click", () => {
      if (balances?.maxVaultWithdraw) {
        $("rd-usdc-withdraw-amt").value = balances.maxVaultWithdraw;
      }
    });

    $("rd-usdc-withdraw-btn")?.addEventListener("click", () => {
      const amt = parseFloat($("rd-usdc-withdraw-amt")?.value ?? "0");
      runAction((p, onProgress) => p.withdrawFromVault(amt, onProgress));
    });

    $("rd-usdc-send-btn")?.addEventListener("click", () => {
      const to = $("rd-usdc-send-to")?.value ?? "";
      const amt = parseFloat($("rd-usdc-send-amt")?.value ?? "0");
      runAction((p, onProgress) => p.sendUsdc(to, amt, onProgress));
    });

    $("rd-azl-send-btn")?.addEventListener("click", () => {
      const to = $("rd-azl-send-to")?.value ?? "";
      const amt = parseFloat($("rd-azl-send-amt")?.value ?? "0");
      runAction((p, onProgress) => p.sendAzl(to, amt, onProgress));
    });

    $("rd-eth-send-btn")?.addEventListener("click", () => {
      const to = $("rd-eth-send-to")?.value ?? "";
      const amt = parseFloat($("rd-eth-send-amt")?.value ?? "0");
      runAction((p, onProgress) => p.sendEth(to, amt, onProgress));
    });

    $("rd-wallet-signout")?.addEventListener("click", () => {
      if (typeof window.azzleLogout === "function") window.azzleLogout();
    });

    refresh();
    setInterval(() => {
      if (!busy && walletAddress) refresh();
    }, 30000);
  }

  window.addEventListener("azzle-wallet-change", (e) => {
    walletAddress = e.detail?.address ?? null;
    refresh();
  });
  window.addEventListener("azzle-poster-ready", () => refresh());

  document.addEventListener("DOMContentLoaded", init);
})();
