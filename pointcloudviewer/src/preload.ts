// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

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

  openPCDFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openPCDFile'),

  openPLYFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openPLYFile'),

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

  // Chat API
  sendChatMessage: (message: string, endpoint?: string): Promise<any> =>
    ipcRenderer.invoke('chat:sendMessage', message, endpoint),

  // Point cloud helpers
  saveTempPLY: (data: ArrayBuffer): Promise<string | null> =>
    ipcRenderer.invoke('fs:saveTempPLY', Buffer.from(data)),

  exportSubmaps: (paths: string[]): Promise<string | null> =>
    ipcRenderer.invoke('fs:exportSubmaps', paths),

  // Live capture (GoPro / GoPro + Helios2)
  startLiveCapture: (mode: 'gopro' | 'gopro_helios', previewOnly: boolean = false): Promise<void> =>
    ipcRenderer.invoke('capture:start', mode, previewOnly),

  stopLiveCapture: (): Promise<void> =>
    ipcRenderer.invoke('capture:stop'),

  onCaptureFrame: (handler: (msg: any) => void): void => {
    ipcRenderer.on('capture:frame', (_event, msg) => handler(msg));
  },
});
