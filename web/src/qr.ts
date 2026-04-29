import * as QRCode from "qrcode";

export async function renderQr(canvas: HTMLCanvasElement, url: string): Promise<void> {
  await QRCode.toCanvas(canvas, url, {
    width: 240,
    margin: 1,
    color: {
      dark: "#15110d",
      light: "#fff8e8",
    },
  });
}

export function joinUrl(room: string): string {
  const url = new URL(window.location.origin);
  url.searchParams.set("room", room);
  return url.toString();
}
