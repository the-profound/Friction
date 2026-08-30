export const MAX_COVER_PHOTO_BYTES = 10 * 1024 * 1024;

export interface SelectedCoverPhoto {
  uri: string;
  name: string;
  size: number;
  contentType: string;
  blob: Blob;
}