/** Detect image type from file magic bytes (not browser-declared MIME). */

export type DetectedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/avif";

export function detectImageMimeFromBytes(bytes: Uint8Array): DetectedImageType | null {
  if (bytes.length < 12) return null;
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  // WEBP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  // AVIF / HEIF family: ....ftyp....avif|avis|mif1
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === "avif" || brand === "avis" || brand === "mif1") return "image/avif";
  }
  return null;
}

export async function assertAllowedImageFile(
  file: File,
  allowed: ReadonlySet<string>,
): Promise<DetectedImageType> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detected = detectImageMimeFromBytes(header);
  if (!detected || !allowed.has(detected)) {
    throw new Error("Choose a JPEG, PNG, WebP or AVIF image.");
  }
  // Reject MIME spoofing when the browser declares a conflicting type.
  if (file.type && file.type !== detected && allowed.has(file.type)) {
    throw new Error("File contents do not match the declared image type.");
  }
  return detected;
}
