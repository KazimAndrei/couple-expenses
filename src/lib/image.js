// Перекодирование картинок перед загрузкой на сервер.
// Побочный эффект, ради которого это и делается: canvas рисует только пиксели,
// поэтому EXIF (в том числе GPS-координаты съёмки) в результат не попадает —
// иначе фото чека уносило бы на сервер место, где его сняли.
export async function reencodeImage(file, { maxSide = 1600, square = false, quality = 0.85 } = {}) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (square) {
      const side = Math.min(img.width, img.height);
      canvas.width = maxSide;
      canvas.height = maxSide;
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, maxSide, maxSide);
    } else {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('image encode failed');
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
