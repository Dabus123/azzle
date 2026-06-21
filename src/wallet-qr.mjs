import QRCode from "qrcode";

window.azzleRenderQr = async function renderWalletQr(canvas, address) {
  await QRCode.toCanvas(canvas, address, {
    width: 220,
    margin: 2,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
};
