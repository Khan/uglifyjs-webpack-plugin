"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _os = _interopRequireDefault(require("os"));

var _cacache = _interopRequireDefault(require("cacache"));

var _findCacheDir = _interopRequireDefault(require("find-cache-dir"));

var _workerFarm = _interopRequireDefault(require("worker-farm"));

var _serializeJavascript = _interopRequireDefault(require("serialize-javascript"));

var _minify = _interopRequireDefault(require("./minify"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const workerFile = require.resolve('./worker');

class TaskRunner {
  constructor(options = {}) {
    const {
      cache,
      parallel
    } = options;
    this.cacheDir = cache === true ? (0, _findCacheDir.default)({
      name: 'uglifyjs-webpack-plugin'
    }) : cache; // In some cases cpus() returns undefined
    // https://github.com/nodejs/node/issues/19022

    const cpus = _os.default.cpus() || {
      length: 1
    };
    this.maxConcurrentWorkers = parallel === true ? cpus.length - 1 : Math.min(Number(parallel) || 0, cpus.length - 1);
  }

  run(tasks, callback) {
    /* istanbul ignore if */
    if (!tasks.length) {
      callback(null, []);
      return;
    }

    if (this.maxConcurrentWorkers > 1) {
      const workerOptions = process.platform === 'win32' ? {
        maxConcurrentWorkers: this.maxConcurrentWorkers,
        maxConcurrentCallsPerWorker: 1
      } : {
        maxConcurrentWorkers: this.maxConcurrentWorkers
      };
      this.workers = (0, _workerFarm.default)(workerOptions, workerFile);

      this.boundWorkers = (options, cb) => {
        try {
          this.workers((0, _serializeJavascript.default)(options), cb);
        } catch (error) {
          // worker-farm can fail with ENOMEM or something else
          cb(error);
        }
      };
    } else {
      this.boundWorkers = (options, cb) => {
        try {
          cb(null, (0, _minify.default)(options));
        } catch (error) {
          cb(error);
        }
      };
    }

    let toRun = tasks.length;
    const results = [];

    const step = (index, data) => {
      toRun -= 1;
      results[index] = data;

      if (!toRun) {
        callback(null, results);
      }
    };

    tasks.forEach((task, index) => {
      const enqueue = () => {
        this.boundWorkers(task, (error, data) => {
          const result = error ? {
            error
          } : data;

          const done = () => step(index, result);

          if (this.cacheDir && !result.error) {
            _cacache.default.put(this.cacheDir, task.cacheKey, JSON.stringify(data)).then(done, done);
          } else {
            done();
          }
        });
      };

      if (this.cacheDir) {
        _cacache.default.get(this.cacheDir, task.cacheKey).then(({
          data
        }) => step(index, JSON.parse(data)), enqueue);
      } else {
        enqueue();
      }
    });
  }

  exit() {
    if (this.workers) {
      _workerFarm.default.end(this.workers);
    }
  }

}

exports.default = TaskRunner;