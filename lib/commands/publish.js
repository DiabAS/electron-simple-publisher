'use strict';

const fs   = require('fs');
const path = require('path');
const line = require('single-line-log').stdout;

module.exports = publish;
module.exports.NAME = 'publish';
module.exports.publishAssets = publishAssets;


function publish(build, options) {
  const transport = options.transport.instance;

  transport.on('progress', onProgress);

  return transport.beforeUpload(build)
    .then(() => {
      return publishAssets(build, transport);
    })
    .then((assets) => {
      if (build.platform === 'darwin') {
        return publishOsxReleaseFile(build, options, assets, transport);
      } else {
        return Promise.resolve(assets);
      }
    })
    .then((assets) => {
      const data = Object.assign({}, options.fields, {
        update:  assets.update,
        'update-local':  assets.local.update,
        install: assets.install,
        'install-local': assets.local.install,
        version: build.version
      });
      if (build.platform === 'win32') {
        data.update = assets.metaFile.replace('/RELEASES', '');
        data['update-local'] = assets.local.metaFile.replace('/RELEASES', '');
      }
      transport.duplicateUpdatesJson(build, data);

      return transport.updateUpdatesJson(build, data);
    })
    .then(() => {
      return transport.compressReleases(build);
    })
    .then((filePath) => {
      return transport.uploadReleaseArchive(filePath);
    })
    .then(() => {
      return transport.afterUpload(build);
    });
}

/**
 * Выкладывает на сервер обновления и возвращает их пути
 *
 * @param {object} build
 * @param {AbstractTransport} transport
 * @return {Promise.<object>} Assets urls
 */
function publishAssets(build, transport) {
  const assets = build.assets;
  let promise = Promise.resolve();
  const result = {
    local: {}
  };
  const uploaded = {};

  if (!Object.keys(assets).length) {
    const buildId = transport.getBuildId(build);
    throw new Error(
      `There are no assets for build ${buildId}. Check the dist folder.`
    );
  }

  for (let name in assets) {
    if (!assets.hasOwnProperty(name)) continue;

    const filePath = assets[name];
    promise = promise
      .then(() => {
        if (uploaded[filePath] === undefined) {
          return transport.uploadFile(filePath, build);
        } else {
          return Promise.resolve(uploaded[filePath]);
        }
      })
      .then((fileUrl) => {
        transport.duplicateMetaFiles(filePath, build);
        return Promise.resolve(fileUrl);
      })
      .then((fileUrl) => {
        if (fileUrl) {
          result[name] = fileUrl;
          result.local[name] = [transport.getBuildId(build), path.basename(fileUrl)].join('/');
        }
        uploaded[filePath] = fileUrl || '';
        line('');
      });
  }

  return promise.then(() => result);
}

function publishOsxReleaseFile(build, options, assets, transport) {
  const data = {
    url: assets.update,
    name: options.fields.name || '',
    notes: options.fields.notes || '',
    pub_date: new Date().toISOString()
  };

  const releaseFilePath = path.join(build.assetsPath, 'release.json');
  fs.writeFileSync(releaseFilePath, JSON.stringify(data, null, '  '));

  return transport.uploadFile(releaseFilePath, build)
    .then((releaseUrl) => {
      assets.update = releaseUrl;
      return assets;
    });
}

/**
 * @param {Object} progress
 * @param {string} progress.name
 * @param {number} progress.transferred
 * @param {number} progress.total
 */
function onProgress(progress) {
  const value = progress.transferred / progress.total;
  const percentage = Math.round(value * 100);

  let bar = new Array(Math.floor(50 * value)).join('█');
  while (bar.length < 49) {
    bar += '.';
  }

  const size = formatSize(progress.transferred) +
    ' / ' + formatSize(progress.total);

  line([
    `\nUploading ${progress.name}\n`,
    `[${bar}] ${percentage}% (${size})\n`
  ].join(''));
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const e = Math.floor(Math.log(bytes) / Math.log(1024));
  return +(bytes / (Math.pow(1024, e))).toFixed(2) + ' ' +
    'BKMGTP'.charAt(e).replace('B', '') + 'B';
}