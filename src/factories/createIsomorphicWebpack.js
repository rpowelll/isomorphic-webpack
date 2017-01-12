// @flow

import path from 'path';
import {
  Compiler
} from 'webpack';
import {
  SourceMapConsumer
} from 'source-map';
import createDebug from 'debug';
import type {
  UserIsomorphicWebpackConfigurationType
} from '../types';
import evalCodeInBrowser from '../utilities/evalCodeInBrowser';
import createCompiler from './createCompiler';
import createCompilerCallback from './createCompilerCallback';
import createCompilerConfiguration from './createCompilerConfiguration';
import createIsomorphicWebpackConfiguration from './createIsomorphicWebpackConfiguration';

const debug = createDebug('isomorphic-webpack');

type IsomorphicWebpackType = {|

  /**
   * @see https://webpack.github.io/docs/node.js-api.html#compiler
   */
  compiler: Compiler,
  createCompilationPromise: Function,
  evalBundleCode: Function,
  formatErrorStack: Function
|};

type ErrorPositionType = {|
  +column: number,
  +line: number,
  +source: string
|};

export default (webpackConfiguration: Object, userIsomorphicWebpackConfiguration?: UserIsomorphicWebpackConfigurationType): IsomorphicWebpackType => {
  const isomorphicWebpackConfiguration = createIsomorphicWebpackConfiguration(userIsomorphicWebpackConfiguration);
  const compilerConfiguration = createCompilerConfiguration(webpackConfiguration, isomorphicWebpackConfiguration.nodeExternalsWhitelist);
  const compiler = createCompiler(compilerConfiguration);

  let createCompilationPromise;

  /**
   * @see https://github.com/gajus/isomorphic-webpack#isomorphic-webpack-faq-how-to-delay-request-handling-while-compilation-is-in-progress
   */
  if (isomorphicWebpackConfiguration.useCompilationPromise) {
    let compilationPromise;
    let compilationPromiseResolve;
    let compilationPromiseIsResolved = true;

    createCompilationPromise = () => {
      return compilationPromise;
    };

    compiler.plugin('compile', () => {
      debug('compiler event: compile (compilationPromiseIsResolved: %s)', compilationPromiseIsResolved);

      if (!compilationPromiseIsResolved) {
        return;
      }

      compilationPromiseIsResolved = false;

      compilationPromise = new Promise((resolve) => {
        compilationPromiseResolve = resolve;
      });
    });

    compiler.plugin('done', () => {
      debug('compiler event: done');

      compilationPromiseIsResolved = true;

      compilationPromiseResolve();
    });
  } else {
    createCompilationPromise = () => {
      throw new Error('"createCompilationPromise" feature has not been enabled.');
    };
  }

  let bundleSourceMapConsumer;

  let currentBundleCode;
  let currentRequestMap;

  const evalBundleCode = (windowUrl?: string) => {
    const module = evalCodeInBrowser(currentBundleCode, {}, windowUrl);

    // @todo abstract into a utility function
    let entryScriptPath;

    if (typeof compiler.options.entry === 'string') {
      entryScriptPath = compiler.options.entry;
    } else if (Array.isArray(compiler.options.entry)) {
      entryScriptPath = webpackConfiguration.entry[webpackConfiguration.entry.length - 1];
    } else {
      const bundles = Object.values(compiler.options.entry);

      if (bundles.length === 0) {
        throw new Error('Invalid "entry" configuration.');
      } else if (bundles.length > 1) {
        // eslint-disable-next-line no-console
        console.log('Multiple bundles are not supported. See https://github.com/gajus/isomorphic-webpack/issues/10.');

        throw new Error('Unsupported "entry" configuration.');
      }

      // $FlowFixMe
      entryScriptPath = bundles[0][bundles[0].length - 1];
    }

    // @todo Make it work in Windows.
    const relativeEntryScriptPath = './' + path.relative(webpackConfiguration.context, require.resolve(entryScriptPath));

    const moduleId = currentRequestMap[relativeEntryScriptPath];

    if (typeof moduleId !== 'number') {
      throw new Error('Cannot determine entry module ID.');
    }

    debug('evaluating module ID %i', moduleId);

    return module(moduleId);
  };

  const compilerCallback = createCompilerCallback(compiler, ({
    bundleCode,
    bundleSourceMap,
    requestMap
  }) => {
    bundleSourceMapConsumer = new SourceMapConsumer(bundleSourceMap);
    currentBundleCode = bundleCode;
    currentRequestMap = requestMap;
  });

  compiler.watch({}, compilerCallback);

  const isOriginalPositionDiscoverable = (lineNumber: number, columnNumber: number): boolean => {
    const originalPosition = bundleSourceMapConsumer.originalPositionFor({
      column: columnNumber,
      line: lineNumber
    });

    return originalPosition.source !== null && originalPosition.line !== null && originalPosition.column !== null;
  };

  const getOriginalPosition = (lineNumber: number, columnNumber: number): ErrorPositionType => {
    const originalPosition = bundleSourceMapConsumer.originalPositionFor({
      column: columnNumber,
      line: lineNumber
    });

    return {
      column: originalPosition.column,
      line: originalPosition.line,
      source: originalPosition.source.replace('webpack://', webpackConfiguration.context)
    };
  };

  const formatErrorStack = (errorStack: string): string => {
    return errorStack.replace(/isomorphic-webpack:(\d+):(\d+)/g, (match, lineNumber, columnNumber) => {
      const targetLineNumber = Number(lineNumber);
      const targetColumnNumber = Number(columnNumber);

      if (!isOriginalPositionDiscoverable(targetLineNumber, targetColumnNumber)) {
        return match;
      }

      const originalPosition = getOriginalPosition(targetLineNumber, targetColumnNumber);

      return originalPosition.source + ':' + originalPosition.line + ':' + originalPosition.column;
    });
  };

  return {
    compiler,
    createCompilationPromise,
    evalBundleCode,
    formatErrorStack
  };
};
