// ;(globalThis as any).__dirname = (globalThis as any).__dirname ?? '/';
// ;(globalThis as any).__filename = (globalThis as any).__filename ?? '/index.js';
// ;(globalThis as any).process = (globalThis as any).process ?? { browser: true };

// --- ADD THIS AT THE VERY TOP ---
// console.log('--- [RENDERER] renderer.ts EXECUTING ---');
// console.log(
//   '[DEBUG] typeof __dirname:', 
//   typeof __dirname
// );
// console.log(
//   '[DEBUG] typeof __filename:', 
//   typeof __filename
// );
// --- END OF DEBUG BLOCK ---

/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/latest/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */
// src/renderer.ts

// In src/renderer.ts

// --- REPLACE YOUR ENTIRE FILE CONTENT WITH THIS ---
console.log('--- [RENDERER] renderer.ts EXECUTING (TOP OF FILE) ---');

// 1. Check for Node.js globals
console.log('--- [RENDERER] Checking Node.js Globals ---');
try {
  console.log(`[Renderer] typeof __dirname: ${typeof __dirname}`);
  if (typeof __dirname !== 'undefined') {
    console.log(`[Renderer] VALUE __dirname: ${__dirname}`);
  }
} catch (e) {
  console.error('[Renderer] Error accessing __dirname:', e);
}

try {
  console.log(`[Renderer] typeof __filename: ${typeof __filename}`);
  if (typeof __filename !== 'undefined') {
    console.log(`[Renderer] VALUE __filename: ${__filename}`);
  }
} catch (e) {
  console.error('[Renderer] Error accessing __filename:', e);
}

// 2. Check for `process` object
console.log('--- [RENDERER] Checking `process` Object ---');
try {
  console.log(`[Renderer] typeof process: ${typeof process}`);
  if (typeof process !== 'undefined') {
    console.log(`[Renderer] process.type: ${process.type}`); // Should be 'renderer'
    console.log(`[Renderer] process.versions.node: ${process.versions.node}`);
    console.log(`[Renderer] process.browser: ${process.browser}`); // Webpack polyfill
  }
} catch (e) {
  console.error('[Renderer] Error accessing process:', e);
}

// 3. Check for `window` and `electron` preload
console.log('--- [RENDERER] Checking Browser Globals ---');
try {
  console.log(`[Renderer] typeof window: ${typeof window}`);
  console.log(`[Renderer] typeof window.electron: ${typeof (window as any).electron}`);
  if (typeof (window as any).electron === 'object') {
    console.log('[Renderer] Preload script (window.electron) seems to be ATTACHED.');
  } else {
    console.warn('[Renderer] Preload script (window.electron) is NOT attached.');
  }
} catch (e) {
  console.error('[Renderer] Error accessing window:', e);
}

// 4. Import styles (this is usually safe)
console.log('--- [RENDERER] Importing styles... ---');
import './styles/globals.css';
console.log('✅ [Renderer] Styles imported.');

// 5. Attempt to load main app
console.log('--- [RENDERER] Attempting to import ./app... ---');
import('./app')
  .then(() => {
    console.log('✅ [Renderer] Main app (./app) loaded successfully.');

    // 6. Run post-load logic
    console.log('[Renderer] Running post-load logic (getAppPath)...');
    window.electron
      .getAppPath()
      .then((appPath) => {
        console.log(`[Renderer] getAppPath() resolved to: ${appPath}`);
        return window.electron.pathJoin(appPath, 'assets');
      })
      .then((assetsPath) => {
        console.log(`[Renderer] assets directory resolved to: ${assetsPath}`);
      })
      .catch((error) => {
        console.warn('[Renderer] Unable to resolve assets directory via preload bridge:', error);
      });
  })
  .catch(err => {
    // This is where the error you're hunting will most likely be caught
    console.error('❌ [Renderer] FAILED to load ./app. The error is:', err);
    console.error('[Renderer] This often happens if an import within ./app (or a file it imports) fails.');
    console.error('[Renderer] Check the error stack above. If it mentions `__dirname` or `__filename` is not defined, it failed before your globals check could run.');
  });
// --- END OF FILE ---
/*
import './styles/globals.css';

console.log(
  '👋 This message is being logged by "renderer.js", included via webpack',
);

import './app';

window.electron
  .getAppPath()
  .then((appPath) => window.electron.pathJoin(appPath, 'assets'))
  .then((assetsPath) => {
    console.log(`[Renderer] assets directory resolved to: ${assetsPath}`);
  })
  .catch((error) => {
    console.warn('[Renderer] Unable to resolve assets directory via preload bridge:', error);
  });
*/