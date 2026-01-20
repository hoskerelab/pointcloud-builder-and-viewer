// --- TOP OF FILE ---
console.log('--- [FORGE CONFIG] initial env TOP OF FILE---', {
  PORT: process.env.PORT,
  WEBPACK_DEV_SERVER_PORT: process.env.WEBPACK_DEV_SERVER_PORT,
  WEBPACK_DEV_SERVER_URL: process.env.WEBPACK_DEV_SERVER_URL,
  ELECTRON_START_URL: process.env.ELECTRON_START_URL,
});

// Hardcoding to '9000' to win the debate.
// process.env.WEBPACK_DEV_SERVER_PORT = '9000';
// process.env.WEBPACK_DEV_SERVER_URL = 'http://localhost:9000';
// process.env.PORT = '9000';

// console.log('--- [FORGE CONFIG] enforced env ---', {
//   PORT: process.env.PORT,
//   WEBPACK_DEV_SERVER_PORT: process.env.WEBPACK_DEV_SERVER_PORT,
//   WEBPACK_DEV_SERVER_URL: process.env.WEBPACK_DEV_SERVER_URL,
// });
// --- END BLOCK ---

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';
import { preloadConfig } from './webpack.preload.config';


// --- ADD THIS DEBUG BLOCK ---
// We will create the devServerConfig as a separate object
// so we can log it BEFORE it gets passed to the plugin.
const devServerConfig = {
  port: 9000,
  host: 'localhost',
  hot: true,
  // --- ADD THIS HEADERS BLOCK ---
  headers: {
    'Content-Security-Policy': [
      "default-src 'self' data:;",
      // Allow WebAssembly
      "script-src 'self' 'unsafe-eval' 'unsafe-inline';",
      "style-src 'self' 'unsafe-inline';",
      // Allow HMR and the githack.com server
      "connect-src 'self' ws://localhost:* http://localhost:* https://raw.githack.com;",
    ].join(' '),
  },
  // --- END ADD ---
};

console.log('--- [FORGE CONFIG] devServerConfig OBJECT: ---');
console.log(JSON.stringify(devServerConfig, null, 2));
// --- END BLOCK ---


// --- ADD THIS BLOCK ---
const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      // TEMP: let Forge choose a free port so we can see what it actually binds.
      // port: 9000,
      // port: 0,
      devServer: devServerConfig,

      renderer: {
        config: rendererConfig,
        // devServer: devServerConfig, // Potential fix for port conflict
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.ts',
            name: 'main_window',
            preload: {
              js: './src/preload.ts',
              config: preloadConfig,
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
console.log('--- [FORGE CONFIG] renderer devServerConfig ---', {
  port: 9000,
  host: 'localhost',
  hot: true,
});

export default config;
