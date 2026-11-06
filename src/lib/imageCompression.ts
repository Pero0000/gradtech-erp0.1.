const MAX_IMAGE_WIDTH = 1600;
const THUMBNAIL_WIDTH = 300;
const WEBP_QUALITY = 0.75;
const JPEG_QUALITY = 0.82;

interface EncodedImage {
  blob: Blob;
  extension: 'webp' | 'jpg';
  contentType: 'image/webp' | 'image/jpeg';
}

interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

export interface CompressedImage {
  image: File;
  thumbnail: File;
}

async function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Some mobile browsers decode formats through Image even when createImageBitmap cannot.
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (reason) {
    URL.revokeObjectURL(url);
    throw reason;
  }
}

function encodeCanvas(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/jpeg', quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

async function encodeImage(source: CanvasImageSource, width: number, height: number, maxWidth: number): Promise<EncodedImage> {
  const scale = Math.min(1, maxWidth / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Preglednik ne može pripremiti fotografiju za učitavanje.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const webp = await encodeCanvas(canvas, 'image/webp', WEBP_QUALITY);
  if (webp?.type === 'image/webp') {
    return { blob: webp, extension: 'webp', contentType: 'image/webp' };
  }
  const jpeg = await encodeCanvas(canvas, 'image/jpeg', JPEG_QUALITY);
  if (jpeg?.type === 'image/jpeg') {
    return { blob: jpeg, extension: 'jpg', contentType: 'image/jpeg' };
  }
  throw new Error('Fotografiju nije moguće komprimirati u WebP ili JPEG formatu.');
}

export async function compressPhotoForUpload(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith('image/') && !/\.(avif|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name)) {
    throw new Error('Odabrana datoteka nije podržana slika.');
  }
  let loaded: LoadedImage;
  try {
    loaded = await loadImage(file);
  } catch {
    throw new Error(`Fotografiju „${file.name}” nije moguće otvoriti za kompresiju.`);
  }

  try {
    const [image, thumbnail] = await Promise.all([
      encodeImage(loaded.source, loaded.width, loaded.height, MAX_IMAGE_WIDTH),
      encodeImage(loaded.source, loaded.width, loaded.height, THUMBNAIL_WIDTH),
    ]);
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'fotografija';
    return {
      image: new File([image.blob], `${baseName}.${image.extension}`, { type: image.contentType, lastModified: file.lastModified }),
      thumbnail: new File([thumbnail.blob], `${baseName}-thumbnail.${thumbnail.extension}`, {
        type: thumbnail.contentType,
        lastModified: file.lastModified,
      }),
    };
  } finally {
    loaded.release();
  }
}
