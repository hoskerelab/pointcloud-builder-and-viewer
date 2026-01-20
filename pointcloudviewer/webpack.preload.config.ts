import type { Configuration } from 'webpack';
import { rules } from './webpack.rules';
import * as path from 'path';
import webpack from 'webpack';

// We make a copy of the rules array from webpack.rules.ts
const preloadRules = [...rules];

preloadRules.push({
    test: /[\/\\]node_modules[\/\\](?!react-pdf).+\.(m?js|node)$/, // <-- Modified to ignore react-pdf
    parser: { amd: false },
    use: {
      loader: '@vercel/webpack-asset-relocator-loader',
      options: {
        outputAssetBase: 'native_modules',
      },
    },
});

// Add the specific ts-loader rule for the preload script
preloadRules.push({
  test: /\.tsx?$/,
  exclude: /(node_modules|\.webpack)/,
  use: {
    loader: 'ts-loader',
    options: {
      transpileOnly: true,
      compilerOptions: {
        module: 'commonjs', // Force CommonJS for Node.js (preload script)
      },
    },
  },
});

export const preloadConfig: Configuration = {
  name: 'preload', // name for debugging/logging purposes
  target: 'electron-preload', // no eval-based sourcemaps/wrappers
  devtool: false, 

  module: {
    rules: preloadRules,
  },
  resolve: {
    extensions: ['.js', '.ts', '.json'],
    alias: {
      '@': path.resolve(__dirname),
      // Hard-block HMR/WDS in preload
      'webpack-dev-server/client': false,
      'webpack/hot/dev-server': false,
      'webpack/hot/log': false,
      'webpack/hot/log-apply-result': false,
    },
  },
  externalsPresets: { electronPreload: true },
  plugins: [
    // Double-lock: if anything gets through, ignore it
    new webpack.IgnorePlugin({ resourceRegExp: /webpack-dev-server\/client/ }),
    new webpack.IgnorePlugin({ resourceRegExp: /webpack\/hot\/dev-server/ }),
  ],
};

// --- ADD THIS LOG AT THE BOTTOM ---
console.log('--- [WEBPACK PRELOAD CONFIG] FINAL CONFIG: ---');
console.log(JSON.stringify(preloadConfig, (key, value) => {
  if (value instanceof RegExp) return value.toString();
  if (typeof value === 'function') return `[Function: ${key}]`;
  return value;
}, 2));
// --- END BLOCK ---