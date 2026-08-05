(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (n, unit = "") => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 6 }) + unit;

  function status(text, kind) {
    const el = $("union-status"); el.textContent = text; el.className = "rd-checkout-status" + (kind ? ` ${kind}` : "");
  }
  async function api() {
    if (!window.azzlePoster?.ready) throw new Error("Sign in with your Base wallet first.");
    return window.azzlePoster;
  }
  async function refresh() {
    try {
      status("Reading Union state from Base…", "busy");
      const [overviewRes, bridge] = await Promise.all([
        fetch("/api/union/overview", { cache: "no-store" }),
        api().catch(() => null),
      ]);
      const overview = overviewRes.ok ? await overviewRes.json() : null;
      const position = bridge?.getUnionPosition ? await bridge.getUnionPosition() : null;
      const active = overview?.stakingActive ?? position?.active ?? false;
      $("union-active").textContent = active ? "Active — AZL staking and rewards are live." : "Activation pending. Staking is owner-activated.";
      $("union-lead").textContent = active
        ? "Stake AZL to mine Action Credits and earn configured protocol rewards."
        : "Union is deployed on Base. Action Credit mining begins only once staking is activated.";
      $("union-panel").hidden = false;
      const actionsEnabled = Boolean(active && position?.signedIn);
      ["union-stake", "union-unstake", "union-claim-unstake", "union-bank", "union-claim-rewards"]
        .forEach((id) => { $(id).disabled = !actionsEnabled; });
      $("union-wallet-azl").textContent = position ? fmt(position.walletAzl, " AZL") : "Sign in to view";
      $("union-staked").textContent = position ? fmt(position.stakedAzl, " AZL") : "—";
      $("union-pending").textContent = position ? fmt(position.pendingUnstakeAzl, " AZL") : "—";
      $("union-credits").textContent = position ? fmt(position.credits) : "—";
      $("union-whole").textContent = position?.wholeCredits ?? "—";
      $("union-remaining").textContent = overview ? fmt(BigInt(overview.creditsRemaining) / 10n ** 18n) : "—";
      $("union-rewards").textContent = position ? fmt(position.claimableAzl, " AZL") : "—";
      $("union-total").textContent = overview ? fmt(BigInt(overview.totalStakedAzl) / 10n ** 18n, " AZL") : "—";
      status(active ? "Union active. Values are read directly from Base." : "Pre-launch mode. No stake can accrue before activation.", active ? "ok" : "");
    } catch (error) { status(error.message || "Could not load Union state.", "err"); }
  }
  async function transact(action, value) {
    try {
      const bridge = await api(); status("Waiting for wallet confirmation…", "busy");
      await bridge.unionTx(action, value, (message) => status(message || "Confirming transaction…", "busy"));
      await refresh(); status("Transaction confirmed on Base.", "ok");
    } catch (error) { status(error.message || "Transaction failed.", "err"); }
  }
  $("union-refresh").addEventListener("click", refresh);
  $("union-stake").addEventListener("click", () => transact("stake", $("union-stake-amount").value));
  $("union-unstake").addEventListener("click", () => transact("unstake", $("union-unstake-amount").value));
  $("union-claim-unstake").addEventListener("click", async () => transact("claimUnstakeTo", null));
  $("union-bank").addEventListener("click", () => transact("bankCredits"));
  $("union-claim-rewards").addEventListener("click", () => transact("claimRewards"));
  window.addEventListener("azzle-wallet-change", refresh);
  window.addEventListener("azzle-poster-ready", refresh);
  window.addEventListener("azzle-bridge-ready", refresh);
  refresh();
})();
