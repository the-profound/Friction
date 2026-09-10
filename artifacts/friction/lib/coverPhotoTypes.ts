export const MAX_COVER_PHOTO_BYTES = 10 * 1024 * 1024;

interface SelectedCoverPhotoBase {
  uri: string;
  name: string;
  size: number;
  contentType: string;
}

export interface SelectedWebCoverPhoto extends SelectedCoverPhotoBase {
  source: "web";
  blob: Blob;
}

export interface SelectedNativeCoverPhoto extends SelectedCoverPhotoBase {
  source: "native";
}

export type SelectedCoverPhoto =
  | SelectedWebCoverPhoto
  | SelectedNativeCoverPhoto;