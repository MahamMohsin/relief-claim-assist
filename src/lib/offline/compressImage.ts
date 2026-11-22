// Client-side image compression for evidence uploads on weak connections.
// Normal: longest side 1280px, JPEG 0.7. 2G Lite: 800px, JPEG 0.6.
export async function compressImage(file: File, lite: boolean): Promise<string> {
  const maxSide = lite ? 800 : 1280;
  const quality = lite ? 0.6 : 0.7;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image compression is unavailable in this browser.");
    context.fillStyle = "#ffffff"; // JPEG has no alpha: flatten transparent PNGs onto white
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close();
  }
}
