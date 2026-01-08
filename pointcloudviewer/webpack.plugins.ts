import CopyWebpackPlugin from 'copy-webpack-plugin';

// Main process plugins
export const mainPlugins = [];

// Renderer process plugins (PDF worker only, no type-checking)
export const rendererPlugins = [
  new CopyWebpackPlugin({
    patterns: [
      {
        from: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
        to: 'pdf.worker.min.mjs',
      },
    ],
  }),
];
