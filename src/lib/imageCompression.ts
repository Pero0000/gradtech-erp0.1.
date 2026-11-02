const MAX_IMAGE_WIDTH = 1600;
const THUMBNAIL_WIDTH = 300;
const WEBP_QUALITY = 0.75;

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
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
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

function toWebp(source: CanvasImageSource, width: number, height: number, maxWidth: number): Promise<Blob> {
  const scale = Math.min(1, maxWidth / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Preglednik ne može pripremiti fotografiju za učitavanje.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Fotografiju nije moguće komprimirati.'));
      } else if (blob.type !== 'image/webp') {
        reject(new Error('Ovaj preglednik ne podržava spremanje fotografija u WebP formatu.'));
      } else {
        resolve(blob);
      }
    }, 'image/webp', WEBP_QUALITY);
  });
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
    const [imageBlob, thumbnailBlob] = await Promise.all([
      toWebp(loaded.source, loaded.width, loaded.height, MAX_IMAGE_WIDTH),
      toWebp(loaded.source, loaded.width, loaded.height, THUMBNAIL_WIDTH),
    ]);
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'fotografija';
    return {
      image: new File([imageBlob], `${baseName}.webp`, { type: 'image/webp', lastModified: file.lastModified }),
      thumbnail: new File([thumbnailBlob], `${baseName}-thumbnail.webp`, { type: 'image/webp', lastModified: file.lastModified }),
    };
  } finally {
    loaded.release();
  }
}
