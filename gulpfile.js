/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/* eslint require-jsdoc: "off" */


var browserify = require('browserify');
var buffer = require('vinyl-buffer');
var envify = require('envify');
var eslint = require('gulp-eslint');
var fs = require('fs');
var gulp = require('gulp');
var gulpIf = require('gulp-if');
var gutil = require('gulp-util');
var sauceConnectLauncher = require('sauce-connect-launcher');
var seleniumServerJar = require('selenium-server-standalone-jar');
var source = require('vinyl-source-stream');
var sourcemaps = require('gulp-sourcemaps');
var spawn = require('child_process').spawn;
var uglify = require('gulp-uglify');
var webdriver = require('gulp-webdriver');


var pkg = require('./package.json');
var server = require('./test/server');


var seleniumServer;
var sshTunnel;


process.env.AUTOTRACK_VERSION = process.env.AUTOTRACK_VERSION || pkg.version;


/**
 * @return {boolean} True if NODE_ENV is production.
 */
function isProd() {
  return process.env.NODE_ENV == 'production';
}


gulp.task('javascript', function(done) {
  // Gets the license string from this file (the first 15 lines),
  // and adds an @license tag.
  var license = fs.readFileSync(__filename, 'utf-8')
      .split('\n').slice(0, 15)
      .join('\n').replace(/^\/\*\*/, '/**\n * @license');

  var version = '/*! autotrack.js v' + pkg.version + ' */';

  browserify('./', {
    debug: true
  })
  .transform(envify)
  .bundle()

  // TODO(philipwalton): Add real error handling.
  // This temporary hack fixes an issue with tasks not restarting in
  // watch mode after a syntax error is fixed.
  .on('error', function(err) { gutil.beep(); done(err); })
  .on('end', done)

  .pipe(source('./autotrack.js'))
  .pipe(buffer())
  .pipe(sourcemaps.init({loadMaps: true}))
  .pipe(gulpIf(isProd(), uglify({
    output: {preamble: license + '\n\n' + version}
  })))
  .pipe(sourcemaps.write('./'))
  .pipe(gulp.dest('./'));
});


gulp.task('lint', function () {
  return gulp.src(['gulpfile.js', 'lib/**/*.js', 'test/**/*.js'])
      .pipe(eslint())
      .pipe(eslint.format())
      .pipe(eslint.failAfterError());
});


gulp.task('test', ['javascript', 'lint', 'tunnel', 'selenium'], function() {
  function stopServers() {
    sshTunnel.close();
    server.stop();
    if (!process.env.CI) {
      seleniumServer.kill();
    }
  }
  return gulp.src('./wdio.conf.js')
      .pipe(webdriver())
      .on('end', stopServers);
});


gulp.task('tunnel', ['serve'], function(done) {
  var opts = {
    username: process.env.SAUCE_USERNAME,
    accessKey: process.env.SAUCE_ACCESS_KEY,
    verbose: true,
  };
  sauceConnectLauncher(opts, function(err, sauceConnectProcess) {
    if (err) {
      done(err);
    } else {
      process.env.BASE_URL = 'http://localhost:8080';
      sshTunnel = sauceConnectProcess;
      process.on('exit', sshTunnel.close.bind(sshTunnel));
      done();
    }
  });
});


gulp.task('serve', ['javascript'], function(done) {
  server.start(done);
  process.on('exit', server.stop.bind(server));
});


gulp.task('selenium', function(done) {
  // Don't start the selenium server on CI.
  if (process.env.CI) return done();

  seleniumServer = spawn('java',  ['-jar', seleniumServerJar.path]);
  seleniumServer.stderr.on('data', function(data) {
    if (data.indexOf('Selenium Server is up and running') > -1) {
      done();
    }
  });
  process.on('exit', seleniumServer.kill.bind(seleniumServer));
});


gulp.task('watch', ['serve'], function() {
  gulp.watch('./lib/**/*.js', ['javascript']);
});


gulp.task('build', ['test']);
