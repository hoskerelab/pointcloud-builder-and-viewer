import type { Configuration } from 'webpack';
import * as path from 'path';
import webpack from 'webpack';
import { rules as baseRules } from './webpack.rules';

const rules = [...baseRules];

// TS for renderer only (ESNext modules ok)
rules.push({
  test: /\.tsx?$/,
  exclude: /(node_modules|\.webpack)/,
  use: {
    loader: 'ts-loader',
    options: { transpileOnly: true },
  },
});

// CSS for renderer only
rules.push({
  test: /\.css$/,
  use: [
    { loader: 'style-loader' },
    { loader: 'css-loader' },
    {
      loader: 'postcss-loader',
      options: {
        postcssOptions: {
          plugins: { '@tailwindcss/postcss': {} },
        },
      },
    },
  ],
});

export const rendererConfig: Configuration = {
  name: 'renderer', // name for debugging/logging purposes
  devtool: 'source-map', // for eval() based sourcemaps (CSP conflicts otherwise)
  target: 'web', // Clear up require() node.js warnings
  // target: 'electron-renderer',

  devServer: {
    hot: true,
    port: 3000,
    client: { webSocketURL: 'ws://localhost:3000/ws' },
    // --- ADD THIS ENTIRE BLOCK ---
    headers: {
      'Content-Security-Policy': [
        "default-src 'self' data:;",
        // Allow WebAssembly
        "script-src 'self' 'unsafe-eval' 'unsafe-inline';",
        "style-src 'self' 'unsafe-inline';",
        "img-src 'self' data: blob: http://localhost:* http://127.0.0.1:*;",
        // Allow HMR and the githack.com server
        "connect-src 'self' ws://localhost:* http://localhost:* https://raw.githack.com;",
      ].join(' '),
    },
    // --- END OF BLOCK ---
  },

  module: { rules },

  plugins: [
    // If ANY 3rd-party code still references __dirname, define a harmless value.
    // Prefer to remove such references in your renderer app code.
    new webpack.DefinePlugin({
      __dirname: JSON.stringify('/'),
      __filename: JSON.stringify('/index.js'),
    }),
  ],

  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    alias: {
      '@': path.resolve(__dirname),
      three: path.resolve(__dirname, 'node_modules/three'),
    },
    fallback: {
      path: require.resolve('path-browserify'),
      events: require.resolve('events/'),
      util: require.resolve('util/'),
      buffer: require.resolve('buffer/'),
      stream: require.resolve('stream-browserify'),
    },
  },

  externals: { canvas: 'commonjs canvas' },
};

// Debug print (optional)
console.log('--- [WEBPACK RENDERER CONFIG] FINAL CONFIG ---');
console.log(JSON.stringify(rendererConfig, (k, v) => {
  if (v instanceof RegExp) return v.toString();
  if (typeof v === 'function') return `[Function: ${k}]`;
  return v;
}, 2));
