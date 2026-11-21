const MAX_DATA_URL_LENGTH = 2_400_000;
const MAX_DIMENSION = 1600;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not read that image file."));
    reader.onerror = () => reject(new Error("Could not read that image file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode that image."));
    img.src = src;
  });
}

/**
 * Accepts any PNG, JPEG, or WebP image (even multi-megabyte phone photos)
 * and downscales/compresses via canvas if needed so it stays well under the
 * 2.8 MB API/DB limit while keeping text sharp for Vision LLM extraction.
 */
export async function prepareDocumentImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }

  const rawDataUrl = await readAsDataUrl(file);
  if (rawDataUrl.length <= 1_400_000) {
    return rawDataUrl;
  }

  const img = await loadImage(rawDataUrl);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    if (rawDataUrl.length <= MAX_DATA_URL_LENGTH) return rawDataUrl;
    throw new Error("Could not compress this image in your browser.");
  }
  ctx.drawImage(img, 0, 0, width, height);

  for (const quality of [0.84, 0.72, 0.58]) {
    const compressed = canvas.toDataURL("image/jpeg", quality);
    if (compressed.length <= MAX_DATA_URL_LENGTH) {
      return compressed;
    }
  }

  // Final pass at smaller dimension if image was extremely dense
  const smallCanvas = document.createElement("canvas");
  smallCanvas.width = Math.max(1, Math.round(width * 0.65));
  smallCanvas.height = Math.max(1, Math.round(height * 0.65));
  const smallCtx = smallCanvas.getContext("2d");
  if (smallCtx) {
    smallCtx.drawImage(img, 0, 0, smallCanvas.width, smallCanvas.height);
    const smallest = smallCanvas.toDataURL("image/jpeg", 0.68);
    if (smallest.length <= MAX_DATA_URL_LENGTH) return smallest;
  }

  throw new Error("Image is still too large after compression. Try cropping or taking a closer photo.");
}
