"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _crypto = _interopRequireDefault(require("crypto"));

var _path = _interopRequireDefault(require("path"));

var _sourceMap = require("source-map");

var _webpackSources = require("webpack-sources");

var _RequestShortener = _interopRequireDefault(require("webpack/lib/RequestShortener"));

var _ModuleFilenameHelpers = _interopRequireDefault(require("webpack/lib/ModuleFilenameHelpers"));

var _schemaUtils = _interopRequireDefault(require("schema-utils"));

var _serializeJavascript = _interopRequireDefault(require("serialize-javascript"));

var _package = _interopRequireDefault(require("uglify-js/package.json"));

var _cacache = _interopRequireDefault(require("cacache"));

var _findCacheDir = _interopRequireDefault(require("find-cache-dir"));

var _options = _interopRequireDefault(require("./options.json"));

var _TaskRunner = _interopRequireDefault(require("./TaskRunner"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }

function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const warningRegex = /\[.+:([0-9]+),([0-9]+)\]/;

class UglifyJsPlugin {
  constructor(options = {}) {
    (0, _schemaUtils.default)(_options.default, options, 'UglifyJs Plugin');
    const {
      minify,
      uglifyOptions = {},
      test = /\.js(\?.*)?$/i,
      chunkFilter = () => true,
      warningsFilter = () => true,
      extractComments = false,
      sourceMap = false,
      cache = false,
      cacheKeys = defaultCacheKeys => defaultCacheKeys,
      parallel = false,
      include,
      exclude
    } = options;
    this.options = {
      test,
      chunkFilter,
      warningsFilter,
      extractComments,
      sourceMap,
      cache,
      cacheKeys,
      parallel,
      include,
      exclude,
      minify,
      uglifyOptions: _objectSpread({
        output: {
          comments: extractComments ? false : /^\**!|@preserve|@license|@cc_on/i
        }
      }, uglifyOptions)
    };
  }

  static isSourceMap(input) {
    // All required options for `new SourceMapConsumer(...options)`
    // https://github.com/mozilla/source-map#new-sourcemapconsumerrawsourcemap
    return Boolean(input && input.version && input.sources && Array.isArray(input.sources) && typeof input.mappings === 'string');
  }

  static buildSourceMap(inputSourceMap) {
    if (!inputSourceMap || !UglifyJsPlugin.isSourceMap(inputSourceMap)) {
      return null;
    }

    return new _sourceMap.SourceMapConsumer(inputSourceMap);
  }

  static buildError(err, file, sourceMap, requestShortener) {
    // Handling error which should have line, col, filename and message
    if (err.line) {
      const original = sourceMap && sourceMap.originalPositionFor({
        line: err.line,
        column: err.col
      });

      if (original && original.source && requestShortener) {
        return new Error(`${file} from UglifyJs\n${err.message} [${requestShortener.shorten(original.source)}:${original.line},${original.column}][${file}:${err.line},${err.col}]`);
      }

      return new Error(`${file} from UglifyJs\n${err.message} [${file}:${err.line},${err.col}]`);
    } else if (err.stack) {
      return new Error(`${file} from UglifyJs\n${err.stack}`);
    }

    return new Error(`${file} from UglifyJs\n${err.message}`);
  }

  static buildWarning(warning, file, sourceMap, requestShortener, warningsFilter) {
    let warningMessage = warning;
    let locationMessage = '';
    let source = null;

    if (sourceMap) {
      const match = warningRegex.exec(warning);

      if (match) {
        const line = +match[1];
        const column = +match[2];
        const original = sourceMap.originalPositionFor({
          line,
          column
        });

        if (original && original.source && original.source !== file && requestShortener) {
          ({
            source
          } = original);
          warningMessage = `${warningMessage.replace(warningRegex, '')}`;
          locationMessage = `[${requestShortener.shorten(original.source)}:${original.line},${original.column}]`;
        }
      }
    }

    if (warningsFilter && !warningsFilter(warning, source)) {
      return null;
    }

    return `UglifyJs Plugin: ${warningMessage}${locationMessage}`;
  }

  apply(compiler) {
    var _this = this;

    const buildModuleFn = moduleArg => {
      // to get detailed location info about errors
      moduleArg.useSourceMap = true;
    };

    const optimizeFn = (compilation, chunks, callback) => {
      const taskRunner = new _TaskRunner.default({
        cache: this.options.cache,
        parallel: this.options.parallel
      });
      const processedAssets = new WeakSet();
      const tasks = [];
      const {
        chunkFilter
      } = this.options;
      const cacheDir = (0, _findCacheDir.default)({
        name: 'uglifyjs-webpack-plugin'
      });
      const promise = Promise.all(Array.from(chunks).filter(chunk => chunkFilter && chunkFilter(chunk)).reduce((acc, chunk) => acc.concat(chunk.files || []), []).concat(compilation.additionalChunkAssets || []).filter(_ModuleFilenameHelpers.default.matchObject.bind(null, this.options)).map(
      /*#__PURE__*/
      function () {
        var _ref = _asyncToGenerator(function* (file) {
          let inputSourceMap;
          const asset = compilation.assets[file];

          if (processedAssets.has(asset)) {
            return;
          }

          try {
            let cacheKey;
            let cacheHit = false;
            const input = asset.source();

            if (_this.options.cache) {
              const defaultCacheKeys = {
                // eslint-disable-next-line global-require
                'uglify-js': _package.default.version,
                // eslint-disable-next-line global-require
                'uglifyjs-webpack-plugin': require('../package.json').version,
                'uglifyjs-webpack-plugin-options': _this.options,
                hash: _crypto.default.createHash('md4').update(input).digest('hex')
              };
              cacheKey = _this.options.cacheKeys ? (0, _serializeJavascript.default)(_this.options.cacheKeys(defaultCacheKeys, file)) : defaultCacheKeys;
              cacheHit = !!(yield _cacache.default.get.info(cacheDir, cacheKey));
            }

            if (_this.options.sourceMap && asset.map && !cacheHit) {
              const map = asset.map(_this.options);

              if (UglifyJsPlugin.isSourceMap(map)) {
                inputSourceMap = map;
              } else {
                inputSourceMap = map;
                compilation.warnings.push(new Error(`${file} contains invalid source map`));
              }
            } else {
              inputSourceMap = null;
            } // Handling comment extraction


            let commentsFile = false;

            if (_this.options.extractComments) {
              commentsFile = _this.options.extractComments.filename || `${file}.LICENSE`;

              if (typeof commentsFile === 'function') {
                commentsFile = commentsFile(file);
              }
            }

            const task = {
              file,
              input,
              inputSourceMap,
              commentsFile,
              extractComments: _this.options.extractComments,
              uglifyOptions: _this.options.uglifyOptions,
              minify: _this.options.minify,
              cacheKey
            };
            tasks.push(task);
          } catch (error) {
            compilation.errors.push(UglifyJsPlugin.buildError(error, file, UglifyJsPlugin.buildSourceMap(inputSourceMap), new _RequestShortener.default(compiler.context)));
          }
        });

        return function (_x) {
          return _ref.apply(this, arguments);
        };
      }()));
      promise.then(() => {
        taskRunner.run(tasks, (tasksError, results) => {
          if (tasksError) {
            compilation.errors.push(tasksError);
            return;
          }

          results.forEach((data, index) => {
            const {
              file,
              input,
              inputSourceMap,
              commentsFile
            } = tasks[index];
            const {
              error,
              map,
              code,
              warnings
            } = data;
            let {
              extractedComments
            } = data;
            let sourceMap = null;

            if (error || warnings && warnings.length > 0) {
              sourceMap = UglifyJsPlugin.buildSourceMap(inputSourceMap);
            } // Handling results
            // Error case: add errors, and go to next file


            if (error) {
              compilation.errors.push(UglifyJsPlugin.buildError(error, file, sourceMap, new _RequestShortener.default(compiler.context)));
              return;
            }

            let outputSource;

            if (map) {
              outputSource = new _webpackSources.SourceMapSource(code, file, JSON.parse(map), input, inputSourceMap);
            } else {
              outputSource = new _webpackSources.RawSource(code);
            } // Write extracted comments to commentsFile


            if (commentsFile && extractedComments && extractedComments.length > 0) {
              if (commentsFile in compilation.assets) {
                const commentsFileSource = compilation.assets[commentsFile].source();
                extractedComments = extractedComments.filter(comment => !commentsFileSource.includes(comment));
              }

              if (extractedComments.length > 0) {
                // Add a banner to the original file
                if (this.options.extractComments.banner !== false) {
                  let banner = this.options.extractComments.banner || `For license information please see ${_path.default.posix.basename(commentsFile)}`;

                  if (typeof banner === 'function') {
                    banner = banner(commentsFile);
                  }

                  if (banner) {
                    outputSource = new _webpackSources.ConcatSource(`/*! ${banner} */\n`, outputSource);
                  }
                }

                const commentsSource = new _webpackSources.RawSource(`${extractedComments.join('\n\n')}\n`);

                if (commentsFile in compilation.assets) {
                  // commentsFile already exists, append new comments...
                  if (compilation.assets[commentsFile] instanceof _webpackSources.ConcatSource) {
                    compilation.assets[commentsFile].add('\n');
                    compilation.assets[commentsFile].add(commentsSource);
                  } else {
                    compilation.assets[commentsFile] = new _webpackSources.ConcatSource(compilation.assets[commentsFile], '\n', commentsSource);
                  }
                } else {
                  compilation.assets[commentsFile] = commentsSource;
                }
              }
            } // Updating assets


            processedAssets.add(compilation.assets[file] = outputSource); // Handling warnings

            if (warnings && warnings.length > 0) {
              warnings.forEach(warning => {
                const builtWarning = UglifyJsPlugin.buildWarning(warning, file, sourceMap, new _RequestShortener.default(compiler.context), this.options.warningsFilter);

                if (builtWarning) {
                  compilation.warnings.push(builtWarning);
                }
              });
            }
          });
          taskRunner.exit();
          callback();
        });
      });
    };

    const plugin = {
      name: this.constructor.name
    };
    compiler.hooks.compilation.tap(plugin, compilation => {
      if (this.options.sourceMap) {
        compilation.hooks.buildModule.tap(plugin, buildModuleFn);
      }

      const {
        mainTemplate,
        chunkTemplate
      } = compilation; // Regenerate `contenthash` for minified assets

      for (const template of [mainTemplate, chunkTemplate]) {
        template.hooks.hashForChunk.tap(plugin, hash => {
          const data = (0, _serializeJavascript.default)({
            uglifyjs: _package.default.version,
            uglifyjsOptions: this.options.uglifyOptions
          });
          hash.update('UglifyJsPlugin');
          hash.update(data);
        });
      }

      compilation.hooks.optimizeChunkAssets.tapAsync(plugin, optimizeFn.bind(this, compilation));
    });
  }

}

var _default = UglifyJsPlugin;
exports.default = _default;