// @flow

import path from 'path';
import {
  DllPlugin
} from 'webpack';
import nodeExternals from 'webpack-node-externals';
import webpackMerge from 'webpack-merge';
import _ from 'lodash';

const replaceLoaders = (loaders) => {
  if (!_.isPlainObject(loaders)) {
    return loaders;
  }

  return _.mapValues(loaders, (value) => {
    if (_.isString(value) && value === 'style-loader') {
      return 'node-style-loader';
    } else if (_.isPlainObject(value)) {
      return replaceLoaders(value);
    } else if (_.isArray(value)) {
      return value.map(replaceLoaders);
    } else {
      return value;
    }
  });
};

export default (webpackConfiguration: Object, nodeExternalsWhitelist: Array<string | RegExp> = []): Object => {
  const manifestPath = path.resolve(webpackConfiguration.context, 'manifest.json');
  const module = replaceLoaders(webpackConfiguration.module);

  const compilerConfiguration = webpackMerge(webpackConfiguration, {
    devtool: 'hidden-source-map',
    externals: [
      nodeExternals({
        importType: 'commonjs2',
        whitelist: nodeExternalsWhitelist
      })

      // @todo
      //
      // Relative resources are not being resolved, because 'require'
      // is relative to the path of the 'overrideRequire' and not to
      // the path of the original resource.
      //
      // @see https://github.com/liady/webpack-node-externals/issues/14
      // (context, request, callback) => {
      //   if (request.includes('node_modules')) {
      //     callback(null, 'require("' + request + '")');
      //     return;
      //   }
      //   callback();
      // }
    ],
    module,
    node: {
      // eslint-disable-next-line id-match
      __dirname: false,
      // eslint-disable-next-line id-match
      __filename: false,
      Buffer: false,
      console: false,
      global: false,
      process: false,
      setImmediate: false
    },
    plugins: [
      new DllPlugin({
        path: manifestPath
      })
    ],
    target: 'node'
  });

  return compilerConfiguration;
};
