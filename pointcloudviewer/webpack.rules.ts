import type { ModuleOptions } from 'webpack';

export const rules: Required<ModuleOptions>['rules'] = [
  // Add support for native node modules
  {
    // We're specifying native_modules in the test because the asset relocator loader generates a
    // "fake" .node file which is really a cjs file.
    test: /native_modules[/\\].+\.node$/,
    use: 'node-loader',
  },
  //
  // DELETE THE 'ts-loader' RULE FROM THIS FILE
  // We will add it to each specific config instead.
  // {
  //   test: /\.tsx?$/,
  //   exclude: /(node_modules|\.webpack)/,
  //   use: {
  //     loader: 'ts-loader',
  //     options: {
  //       transpileOnly: true,
  //     },
  //   },
  // },
  // Handle canvas for react-pdf in Electron
  {
    test: /\.m?js$/,
    resolve: {
      fullySpecified: false,
    },
  },
  // Added rule for .node files inside react-pdf
  {
    test: /react-pdf[\/\\](?!node_modules).*\.node$/,
    use: 'node-loader',
  },
];
