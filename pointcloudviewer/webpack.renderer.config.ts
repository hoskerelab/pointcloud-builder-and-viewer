import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { rendererPlugins } from './webpack.plugins';

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

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins: rendererPlugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    alias: {
      '@': __dirname,
    },
  },
  externals: {
    canvas: 'commonjs canvas',
  },
};
