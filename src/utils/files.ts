export const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** Convert Uint8Array to base64 string, chunked to avoid call-stack overflow on large files. */
export function arrayBufferToBase64(buffer: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  return window.btoa(binary);
}
