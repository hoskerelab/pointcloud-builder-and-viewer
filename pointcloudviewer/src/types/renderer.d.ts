declare module '*.css' {
  const content: string;
  export default content;
}

// Electron API types
interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: Date;
}

interface FileStats {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  modified: Date;
  created: Date;
}

interface QAPair {
  question: string;
  answer: string;
  reference_images: string[];
  condition_rating: {
    score: number;
  } | null;
}

interface SceneGraphEdge {
  connected_to: string;
  description_of_connection: string;
}

interface SceneGraphNode {
  image_name: string;
  central_focus: string;
  image_description: string;
  edges: SceneGraphEdge[];
}

interface SceneGraph {
  nodes: SceneGraphNode[];
}

// Add this interface
interface SegmentationPolygon {
  label: string;
  points: { x: number; y: number; z: number }[];
  area: number;
  confidence: number;
}

interface ChatResponse {
  message?: string;
  content?: string;
  error?: string;
  command?: {
    type: string;
    action: string;
    params?: Record<string, unknown>;
    polygons?: SegmentationPolygon[];
  };
}

interface ElectronAPI {
  openDirectory: () => Promise<string | null>;
  openGLBFile: () => Promise<string | null>;
  readDirectory: (dirPath: string) => Promise<FileInfo[]>;
  getFileStats: (filePath: string) => Promise<FileStats | null>;
  checkSceneFolder: (dirPath: string) => Promise<boolean>;
  getDownloadsPath: () => Promise<string | null>;
  getScenePDFPath: (scenePath: string) => Promise<string | null>;
  getSceneGLBPath: (scenePath: string) => Promise<string | null>;
  getSceneQAPairsPath: (scenePath: string) => Promise<string | null>;
  readQAPairs: (qaPairsPath: string) => Promise<QAPair[] | null>;
  getSceneImages: (scenePath: string) => Promise<string[] | null>;
  getSceneGraphPath: (scenePath: string) => Promise<string | null>;
  readSceneGraph: (sceneGraphPath: string) => Promise<SceneGraph | null>;
  getSceneMetadata: (scenePath: string) => Promise<any | null>;
  readFileBuffer: (filePath: string) => Promise<ArrayBuffer | null>;
  getAppPath: () => Promise<string>;
  pathJoin: (...parts: string[]) => Promise<string>;
  sendChatMessage: (message: string, endpoint?: string) => Promise<ChatResponse>;
  startRtsp: (url: string) => Promise<{ mjpegUrl: string }>;
  stopRtsp: () => Promise<boolean>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
