import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export async function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"], { windowsHide: true });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

export async function encodeRgbaToMp4(
  outPath: string,
  width: number,
  height: number,
  fps: number,
  frameIterator: AsyncIterable<Buffer>
): Promise<void> {
  if (!(await ffmpegAvailable())) {
    throw new Error("ffmpeg not found in PATH — install ffmpeg to encode trailers");
  }

  const args = [
    "-y",
    "-f",
    "rawvideo",
    "-vcodec",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${width}x${height}`,
    "-r",
    String(fps),
    "-i",
    "-",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let stderr = "";

    proc.stderr?.on("data", (c) => {
      stderr += String(c);
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0 && existsSync(outPath)) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`));
    });

    (async () => {
      try {
        for await (const frame of frameIterator) {
          const ok = proc.stdin.write(frame);
          if (!ok) await new Promise((r) => proc.stdin.once("drain", r));
        }
        proc.stdin.end();
      } catch (err) {
        proc.stdin.destroy();
        reject(err);
      }
    })();
  });
}
