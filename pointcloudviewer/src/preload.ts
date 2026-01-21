// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

// --- ADD THIS BLOCK AT THE TOP ---
console.log('--- [PRELOAD SCRIPT] EXECUTING ---');
try {
  console.log(`[Preload] typeof __dirname: ${typeof __dirname}`);
  console.log(`[Preload] __dirname: ${__dirname}`);
  console.log(`[Preload] typeof __filename: ${typeof __filename}`);
  console.log(`[Preload] __filename: ${__filename}`);
  console.log(`[Preload] typeof process: ${typeof process}`);
  console.log(`[Preload] process.versions.node: ${process.versions.node}`);
  console.log(`[Preload] typeof contextBridge: ${typeof contextBridge}`);
} catch (e) {
  console.error('[Preload] Error accessing globals:', e);
}
// --- END BLOCK ---

// More debug
console.log('[Preload] executed, location.href =', window.location.href);

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: Date;
}

export interface FileStats {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  modified: Date;
  created: Date;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // File System Operations
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),

  openGLBFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openGLBFile'),

  readDirectory: (dirPath: string): Promise<FileInfo[]> =>
    ipcRenderer.invoke('fs:readDirectory', dirPath),

  getFileStats: (filePath: string): Promise<FileStats | null> =>
    ipcRenderer.invoke('fs:getStats', filePath),

  checkSceneFolder: (dirPath: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:checkSceneFolder', dirPath),

  getDownloadsPath: (): Promise<string | null> =>
    ipcRenderer.invoke('fs:getDownloadsPath'),

  getScenePDFPath: (scenePath: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:getScenePDFPath', scenePath),

  getSceneGLBPath: (scenePath: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:getSceneGLBPath', scenePath),

  getSceneQAPairsPath: (scenePath: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:getSceneQAPairsPath', scenePath),

  readQAPairs: (qaPairsPath: string): Promise<any[] | null> =>
    ipcRenderer.invoke('fs:readQAPairs', qaPairsPath),

  getSceneImages: (scenePath: string): Promise<string[] | null> =>
    ipcRenderer.invoke('fs:getSceneImages', scenePath),

  getSceneGraphPath: (scenePath: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:getSceneGraphPath', scenePath),

  readSceneGraph: (sceneGraphPath: string): Promise<any | null> =>
    ipcRenderer.invoke('fs:readSceneGraph', sceneGraphPath),
  
  getSceneMetadata: (scenePath: string): Promise<any | null> =>
    ipcRenderer.invoke('fs:getSceneMetadata', scenePath),

  readFileBuffer: (filePath: string): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke('fs:readFileBuffer', filePath),

  getAppPath: (): Promise<string> =>
    ipcRenderer.invoke('app:getPath'),

  pathJoin: (...parts: string[]): Promise<string> =>
    ipcRenderer.invoke('path:join', parts),

  // Chat API
  sendChatMessage: (message: string, endpoint?: string): Promise<any> =>
    ipcRenderer.invoke('chat:sendMessage', message, endpoint),
  //  RTSP / RTSPS Stream (new)
  startRtsp: (url: string): Promise<{ mjpegUrl: string }> =>
    ipcRenderer.invoke("rtsp:start", url),

  stopRtsp: (): Promise<boolean> =>
    ipcRenderer.invoke("rtsp:stop"),

});
