import type { Configuration } from 'webpack';

import { rules as baseRules } from './webpack.rules';
import { mainPlugins } from './webpack.plugins';
import * as path from 'path'; // <-- ADD THIS IMPORT

const rules = [...baseRules];

// Add the specific ts-loader rule for the main process
rules.push({
  test: /\.tsx?$/,
  exclude: /(node_modules|\.webpack)/,
  use: {
    loader: 'ts-loader',
    options: {
      transpileOnly: true,
      compilerOptions: {
        module: 'commonjs', // Force CommonJS for Node.js (main process)
      },
    },
  },
});

export const mainConfig: Configuration = {
  target: 'electron-main', // <-- Also add this target property
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/index.ts',
  // Put your normal webpack config below here
  module: {
    rules,
  },
  plugins: mainPlugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
    alias: {
      '@': path.resolve(__dirname),
    },
  },
};
