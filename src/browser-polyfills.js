import { Buffer } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}
if (typeof globalThis.global === "undefined") {
  globalThis.global = globalThis;
}
