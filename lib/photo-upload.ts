export const MAX_PHOTOS = 20;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

export function validatePhotoFiles(files: File[], existingCount = 0): string | null {
  if (files.length + existingCount > MAX_PHOTOS) return `사진은 아이템당 최대 ${MAX_PHOTOS}장까지 보관할 수 있어요.`;
  if (files.some((file) => !PHOTO_TYPES.includes(file.type) || file.size === 0)) return "JPG, PNG, WEBP, GIF, AVIF 이미지 파일을 선택해 주세요.";
  if (files.some((file) => file.size > MAX_PHOTO_BYTES)) return "사진 한 장의 크기는 10MB 이하여야 해요.";
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_BYTES) return "한 번에 올리는 사진의 전체 크기는 40MB 이하여야 해요.";
  return null;
}
