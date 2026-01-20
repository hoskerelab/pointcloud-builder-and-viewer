import type { Configuration } from 'webpack';
import * as path from 'path';

import { rules as baseRules } from './webpack.rules';
import { rendererPlugins } from './webpack.plugins';

// --- ADD THIS LOG ---
console.log('--- [WEBPACK RENDERER CONFIG] Reading webpack.renderer.config.ts ---');
// --- END LOG ---

// Make a copy of the base rules
const rules = [...baseRules];

rules.push({
  test: /\.css$/,
  use: [
    { loader: 'style-loader' },
    { loader: 'css-loader' },
    {
      loader: 'postcss-loader',
      options: {
        postcssOptions: {
          plugins: {
            '@tailwindcss/postcss': {},
          },
        },
      },
    },
  ],
});

// Add the specific ts-loader rule for the renderer process
rules.push({
  test: /\.tsx?$/,
  exclude: /(node_modules|\.webpack)/,
  use: {
    loader: 'ts-loader',
    options: {
      transpileOnly: true,
      // We DON'T override compilerOptions here.
      // This allows it to use "module": "ESNext" from tsconfig.json
    },
  },
});


export const rendererConfig: Configuration = {
  target: 'electron-renderer',
  node: {
    __dirname: true,
    __filename: true,
  },
  devServer: {
    port: 9000,
    host: 'localhost',
    hot: true,
    client: {
      webSocketURL: {
        protocol: 'ws',
        hostname: 'localhost',
        port: 9000,
      },
    },
  },

  // --- ADD THIS BLOCK ---
  // This tells the webpack-dev-server client code to run in a
  // browser environment, not a Node.js one. This is the key.
  // devServer: {
  //   client: {
  //     webSocketURL: 'ws://localhost:9000/ws', // Explicitly set the websocket URL
  //   },
  //   hot: true, // Ensure hot is enabled
  // },
  // --- END OF BLOCK ---

  module: {
    rules, // Use our modified rules
  },
  plugins: rendererPlugins,
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
  externals: {
    canvas: 'commonjs canvas',
  },
};

// --- ADD THIS BLOCK AT THE VERY END ---
console.log('--- [WEBPACK RENDERER CONFIG] FINAL CONFIG ---');
console.log(JSON.stringify(rendererConfig, (key, value) => {
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (typeof value === 'function') {
    return `[Function: ${key}]`;
  }
  return value;
}, 2));
// --- END BLOCK ---
