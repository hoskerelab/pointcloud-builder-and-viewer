export interface SceneMetadataImageEntry {
  index: number;
  path: string;
}

export interface SceneMetadata {
  image_count: number;
  input_images: SceneMetadataImageEntry[];
  outputs: Record<string, string>;
  settings?: Record<string, unknown>;
}

export interface SceneImage {
  index: number;
  name: string;
  absolutePath: string | null;
  metadataPath?: string;
}

export interface SceneCamera {
  index: number;
  /**
   * Deprecated alias for extrinsicsC2W. Kept for backward compatibility.
   */
  extrinsics: number[][];
  extrinsicsC2W: number[][];
  rotationC2W: number[][];
  extrinsicsW2C: number[][];
  rotationW2C: number[][];
  intrinsics: number[][];
  /**
   * Deprecated alias for positionWorld. Kept for backward compatibility.
   */
  position: [number, number, number];
  positionWorld: [number, number, number];
  /**
   * Deprecated alias for rotationW2C. Kept for backward compatibility.
   */
  rotationMatrix: number[][];
  poseEncoding?: number[] | null;
  image?: SceneImage | null;
  navigableNeighbors: number[];
}

export interface SceneData {
  metadata: SceneMetadata | null;
  images: SceneImage[];
  cameras: SceneCamera[];
}
