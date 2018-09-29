'use strict';

const path                                  = require('path');
const fs                                    = require('fs');
const { addAssetsInfo, getAvailableBuilds } = require('./add-assets-info');

module.exports = normalize;
module.exports.applyPlatformDefaults   = applyPlatformDefaults;
module.exports.applyDefaults           = applyDefaults;
module.exports.applyPackageJson        = applyPackageJson;
module.exports.applyConfigJson         = applyConfigJson;
module.exports.transformBuilds         = transformBuilds;
module.exports.normalizeBuild          = normalizeBuild;
module.exports.validateIfRemoveCommand = validateIfRemoveCommand;

const TRANSPORTS = {
  ftp:    '../transport/ftp',
  github: '../transport/github',
  local:  '../transport/local',
  s3:     '../transport/s3',
  ssh:    '../transport/ssh'
};

/**
 * Подготавливает общие данные и инсталлирует транспорт
 *
 * @param options - общие данные
 * @return {Object}
 */
function normalize(options) {
  options = options || {};

  const configJson  = loadConfigFile(options.config);
  const packageJson = loadPackageJson();

  options = applyConfigJson(options, configJson);
  options = applyPackageJson(options, packageJson);


  options = applyPlatformDefaults(options, process);
  options = applyDefaults(options);

  options = transformBuilds(options);

  validateIfRemoveCommand(options);

  if (options.command === 'publish' || options.command === 'replace') {
    options = addAssetsInfoToBuilds(options);
  }

  options = initializeTransport(options);

  return options;
}

/**
 * Добавление данных публикации в общие данные
 *
 * @param options - общие данные
 * @param configJson - данные публикации
 * @returns {*}
 */
function applyConfigJson(options, configJson) {
  if (typeof configJson.transport === 'string') {
    configJson.transport = { name: configJson.transport };
  }
  options.transport = Object.assign({}, configJson.transport, options.transport);
  options.fields = Object.assign({}, configJson.fields, options.fields);
  return Object.assign({}, configJson, options);
}

/**
 * Добавление данных проекта (package.json) в общие данные
 *
 * @param options - общие данные
 * @param packageJson - данные проекта
 * @returns {*}
 */
function applyPackageJson(options, packageJson) {
  let values = {};
  let updater = packageJson.updater || {};

  options.packageJson = packageJson;

  if (packageJson.version) {
    values.version = packageJson.version;
  }
  if (updater.channel) {
    values.channel = updater.channel;
  }
  if (updater.url) {
    values.updatesJsonUrl = updater.url;
  }
  if (updater.build) {
    const [ platform, arch ] = updater.build.split('-');
    if (platform) {
      values.platform = platform;
    }
    if (arch) {
      values.arch = arch;
    }
  }

  return Object.assign({}, values, options);
}

function applyPlatformDefaults(options, process) {
  const info = {
    platform: process.platform,
    arch: process.arch
  };
  return Object.assign(info, options);
}

function applyDefaults(options) {
  const defaults = {
    channel: 'prod',
    path: 'dist'
  };
  return Object.assign(defaults, options);
}

/**
 * Корректирование или создание массива builds
 *
 * @param options - общие данные
 * @returns {*}
 */
function transformBuilds(options) {
  options.builds = options.builds || [];

  if (options.builds[0] === 'all') {
    options.builds = getAvailableBuilds(options);
  }

  options.builds = options.builds.map(b => normalizeBuild(b, options));

  if (options.command === 'remove') {
    return options;
  }

  if (!options.builds.length) {
    options.builds = [{
      platform: options.platform,
      arch: options.arch,
      channel: options.channel,
      version: options.version
    }];

    if (!options.builds[0].version) {
      throw new Error(
        'Could not determine a version for build. It seems that you\'ve not ' +
        'set a version in your package.json'
      );
    }
  }

  return options;
}

/**
 * Корректирование данных build
 *
 * @param build -
 * @param options - общие данные
 * @returns {*}
 */
function normalizeBuild(build, options) {
  if (typeof build === 'string') {
    const [ platform, arch, channel, version ] = build.split('-');
    build = { platform, arch, channel, version };
  }

  if (options.command !== 'remove') {
    [ 'platform', 'arch', 'channel', 'version' ].forEach((field) => {
      if (!build[field] && options[field]) {
        build[field] = options[field];
      }
    });
  }

  if (build.version && build.version.indexOf('v') === 0) {
    build.version = build.version.substring(1);
  }

  if (!build.version && options.command !== 'remove') {
    throw new Error(
      'Could not determine a version for build. It seems that you\'ve not ' +
      'set a version in your package.json'
    );
  }

  return build;
}

/**
 * Добавляет в объекты builds локальные пути к файлам обновлений и общую папку с обновлениями
 *
 * @param options - общие данные
 * @returns {*}
 */
function addAssetsInfoToBuilds(options) {
  if (options.command === 'remove') {
    return options;
  }

  options.builds.forEach((build, index) => {
    if (typeof build === 'object') {
      options.builds[index] = addAssetsInfo(build, options);
    }
  });

  return options;
}

/**
 * Проверка данных перед удалением
 *
 * @param options - общие данные
 */
function validateIfRemoveCommand(options) {
  if (options.command !== 'remove') {
    return;
  }

  const invalidBuilds = options.builds.filter((build) => {
    if (!build.platform || !build.arch || !build.channel || !build.version) {
      return true;
    }
    const isValid = build.platform.match(/\w+/) &&
      build.arch.match(/\w+/) &&
      build.channel.match(/\w+/) &&
      build.version.match(/\d+\.\d+\.\d+/);
    return !isValid;
  });

  if (!options.builds.length) {
    throw new Error('You should specify one or more builds to remove.');
  }

  if (invalidBuilds.length) {
    throw new Error('For the remove command you need to specify a full buildId.');
  }
}

/**
 * Инициализирует объект транспорта, который будет использоваться для публикации
 *
 * @param options - общие данные
 * @returns {*}
 */
function initializeTransport(options) {
  if (typeof options.transport === 'string') {
    options.transport = { name: options.transport };
  }

  const transport = options.transport;

  if (transport.instance) {
    return options;
  }

  if (transport.constructor !== Object) {
    transport.instance = new transport.constructor(options);
    return options;
  }

  if (transport.module) {
    if (TRANSPORTS[transport.module]) {
      transport.module = TRANSPORTS[transport.module];
    } else if (transport.module.startsWith('{cwd}')) {
      transport.module = transport.module.replace('{cwd}', process.cwd); // cwd - current working directory of process.
    }

    let Transport;
    try {
      Transport = require(transport.module);
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        if (options.debug) {
          console.warn(err);
        }
        throw new Error('Could not load transport ' + transport.module);
      } else {
        throw err;
      }
    }
    transport.instance = new Transport(options);
    return options;
  }

  throw new Error(
    'Could not initialize a transport. Check transport.module option.'
  );
}

/**
 * Получение данных (объекта) для публикации из файла publisher
 *
 * @param configPath - путь до файла с данными публикации
 * @returns {*}
 */
function loadConfigFile(configPath) {
  if (configPath) {
    const json = loadJson(configPath);
    if (!json) {
      throw new Error('Could not read the file ' + configPath);
    }
    return json;
  }

  return loadJson(path.join(process.cwd(), 'publisher.js')) ||
         loadJson(path.join(process.cwd(), 'publisher.json')) || {};
}

/**
 * Получение данных (объекта) из файла package.json
 *
 * @returns {*|{}}
 */
function loadPackageJson() {
  return loadJson(path.join(process.cwd(), 'app', 'package.json')) ||
         loadJson(path.join(process.cwd(), 'package.json')) || {};
}

/**
 * Получение данных (объекта) из файла .js или .json
 *
 * @param filePath - путь до файла с данными
 * @param showError - отображать ли ошибки
 * @returns {*}
 */
function loadJson(filePath, showError = false) {
  try {
    if (path.extname(filePath) === '.js') {
      return require(filePath);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    if (showError) {
      console.log(`Error reading file ${filePath}: ${e}`);
    }
    return false;
  }
}
