var fs = require('fs'),
    url = require('url'),
    path = require('path'),
    _ = require('underscore'),
    util = require('./util');

var config = module.exports = {};
var globalSettingPath = path.join(process.cwd(), './rules/global');
var settingPath = path.join(process.cwd(), './rules/settings');

// mkdir current rules dir
util.mkdirpSync(path.join(process.cwd(), './rules/'));

// try load global settings file
try {
    config.global = require(globalSettingPath);
} catch (e) {
    config.global = {};
}

// default setting in menu bar 
try {
    config.settings = require(settingPath);
} catch (e) {
    config.settings = {};
}

var dafaultGlobal = {
	host: '127.0.0.1',
	uihost: '127.0.0.1',
	http: 8090,
	https: 8001,
	uiport: 8002,
	index: 'index.html',
	tempDir: path.join(process.cwd(), 'tmp/http/'),
	siteDir: path.join(process.cwd(), 'tmp/sites/'),
	// proxy: 'http://proxy.tencent.com:8080'
};

var defaultSetting = {
    keep: false,
    proxy: false,
    disablePool: false,
    disableCache: false,
    autoScroll: false,
    speedLimit: 'Disabled',
    showSession: 'All',
    layout: 'Wide',
    tabSetting: 'Pool,Inspectors,Filter,Composer,Statistics,Timeline,Log',
    sessionColumns: 'Protocol,Method,Host,Path,ContentType,Caching,Body,Time'
};
config.global = _.extend(dafaultGlobal, config.global);
config.settings = _.extend(defaultSetting, config.settings);
config.settings.platform = process.platform;
// reset speed limiter
config.settings.speedLimit = 'Disabled';
util.speedLimitStop();

// rule config root node
config.pool = {};
// project collection
config.projs = [];
// rules groups(handler,router..) of all projs
config.groups = [];
// rules of all projs
config.rules = [];

// handlers(本地替换) 的优先级高级 routers(远程资源)
config.handlers = [];
config.routers = [];

function parseUrl(urlString) {

    var pathname = '/',
        hostname = '';
    // 处理match，获取pathname
    var urlpath = urlString.match(/http[s]?/) ? urlString : 'http://' + urlString;
    var urlInfo = url.parse(urlpath.replace(/\*/g, '__ls__'));
    hostname = urlInfo.hostname.replace(/__ls__/g, '\*');
    pathname = urlInfo.pathname.replace(/__ls__/g, '\*');
    pathname = pathname.indexOf('*') > -1 ? pathname.substring(0, pathname.indexOf('*')) : pathname;
    pathname = pathname.substring(0, pathname.lastIndexOf('/') + 1);

    return {
        hostname: hostname,
        pathname: pathname
    };
};

config.loadRules = function(callback) {
    // init
    config.pool = {};
    config.projs = [];
    config.groups = [];
    config.rules = [];
    config.handlers = [];
    config.routers = [];

    // try load custom pool first
    var poolData = {};
    var poolPath = path.join(process.cwd(), './rules/pool.js');
    try {
        poolData = require(poolPath);
    } catch (e) {
        // load default rules
        var module = path.resolve(__dirname, '../../', 'rules/default.js');
        poolData = require(module);
        // generate rules @ running dir
        util.copyFile(module, poolPath, function(err) {
            if (err) throw err;
        });
    }

    poolData.type = 'root';
    config.pool = poolData;

    _.each(poolData.children, function(proj) {

        proj = proj || {};
        proj.id = proj.id || util.getUUId();
        proj.type = 'proj';
        proj.checked = _.isUndefined(proj.checked) ? true : proj.checked;

        // fix base dir /
        var projBase = _.contains(['\\', '/'], proj.match.charAt(proj.match - 1)) ? proj.match : proj.match + path.sep;
        // var 
        var handler = [],
            router = [];

        // process data, 适配tree
        _.each(proj.children, function(ch) {
            ch = ch || {};
            ch.id = ch.id || util.getUUId();
            ch.type = 'group';
            ch.checked = _.isUndefined(ch.checked) ? true : ch.checked;
            ch.enableDrag = false;
            _.each(ch.children, function(rule) {
                rule.leaf = true;
                rule.id = rule.id || util.getUUId();
                rule.checked = _.isUndefined(rule.checked) ? true : rule.checked;
                config.rules.push(rule);

                if (proj.checked && ch.checked && rule.checked) {
                    if (ch.name == 'handler') {
                        handler.push(rule);
                    } else if (ch.name == 'router') {
                        router.push(rule);
                    }
                }
            });
            config.groups.push(ch);
        });

        handler.forEach(function(item) {
            item.match = item.match || '';
            // var split = item.match.split(/\s+/);
            var split = item.match.split('|');
            split.forEach(function(match) {
                var urlInfo = parseUrl(match);
                config.handlers.push({
                    // 数据兼容, 将match映射为base
                    base: projBase,
                    matchResolve: match.replace(/\./g, '\\.').replace(/\*/g, '.*'),
                    match: match,
                    actionResolve: item.action,
                    action: item.action,
                    indexPage: proj.index || config.global.index,
                    hostname: urlInfo.hostname,
                    pathname: urlInfo.pathname,
                    checked: _.isUndefined(item.checked) ? true : item.checked
                });
            });
        });

        router.forEach(function(item) {
            item.match = item.match || '';
            // var split = item.match.split(/\s+/);
            var split = item.match.split('|');
            var pathname = '/',
                hostname = '';
            split.forEach(function(match) {
                var urlInfo = parseUrl(match);
                config.routers.push({
                    matchResolve: match.replace(/\./g, '\\.').replace(/\*/g, '.*'),
                    match: match,
                    actionResolve: item.action,
                    action: item.action,
                    hostname: urlInfo.hostname,
                    pathname: urlInfo.pathname,
                    checked: _.isUndefined(item.checked) ? true : item.checked
                });
            });
        });
        config.projs.push(proj);
    });
    // console.log(config.handlers);
    // console.log(config.routers);
    callback && callback();
};

config.saveRules = function(callback) {
    var module = path.resolve(process.cwd(), './rules/pool.js');
    var backup = path.resolve(process.cwd(), './rules/pool-bak-' + util.formatDate(new Date(), 'yyyyMMdd-hh') + '.js');
    var pool = 'module.exports=' + JSON.stringify(config.pool, null, 4);
    var fs = require('fs');

    util.copyFile(module, backup, function(err) {
        if (err) throw err;
        fs.writeFile(module, pool, function(err) {
            if (err) throw err;
            config.loadRules(callback);
        });
    });
};

config.saveSettings = function() {
    var module = path.resolve(settingPath + '.js');
    var pool = 'module.exports=' + JSON.stringify(config.settings, null, 4);
    fs.writeFile(module, pool, function(err) {
        if (err) throw err;
    });
};

config.saveGlobalSetting = function() {
    var module = path.resolve(globalSettingPath + '.js');
    var settings = 'module.exports=' + JSON.stringify(config.global, null, 4);
    fs.writeFile(module, settings, function(err) {
        if (err) throw err;
    });
};
config.saveGlobalSetting();

config.getHandler = function(reqInfo, delay) {
    delay = _.isUndefined(delay) ? true : false;
    var action, extname, filepath, base, reg;
    var urlOrgin = reqInfo.url;
    var reqUrl = url.parse(reqInfo.url);
    var pathname = reqUrl.pathname;
    var urlPath = reqUrl.protocol + '//' + reqUrl.host + reqUrl.pathname;

    if (config.settings.disablePool) {
        return;
    }

    return _.find(config.handlers, function(handler) {
        if (!handler.checked) {
            return null;
        }

        // match string has no ? -> only match path of req.url
        var urlRaw = handler.match.indexOf('?') < 0 ？ urlPath : urlOrgin;

        if ((handler.match === urlRaw) || (urlRaw.indexOf(handler.match) >= 0) || new RegExp(handler.matchResolve).test(urlRaw)) {
            // 处理默认页访问 www.livepool.com
            pathname = (pathname == '/') ? ('/' + handler.indexPage) : pathname;
            action = handler.action;

            var respond = {
                type: 'local'
            };

            // if (_.isArray(action)) {
            if (action.indexOf('|') >= 0) {
                respond.type = 'combo';
                filepath = path.resolve(handler.base, pathname.replace('/', ''));
            } else if (action.match(/http[s]?/)) {
                respond.type = 'remote';
            } else if (delay && (reg = action.match(/delay\((\d+)\)/))) {
                respond.type = 'delay';
                respond.delay = parseInt(reg[1]) || 0;
            } else if (path.extname(action) == '.qzmin') {
                respond.type = 'qzmin';
            } else {
                if (util.detectDestType(action) == 'file') {
                    filepath = path.resolve(handler.base, action);
                } else {
                    filepath = path.resolve(handler.base, action, pathname.replace(handler.pathname, ''));
                }

                if (fs.existsSync(filepath)) {
                    respond.type = 'local';
                } else {
                    return false;
                }
            }
            respond.filepath = filepath;
            handler.respond = respond;
            return true;
        }
        return false;
    });
};

config.getRouter = function(reqInfo) {
    if (config.settings.disablePool) {
        return;
    }

    var urlRaw = reqInfo.url;
    var reqUrl = url.parse(urlRaw);
    var urlPath = reqUrl.host + reqUrl.pathname;
    return _.find(config.routers, function(router) {
        if (!router.checked) {
            return null;
        }

        // match string has no ? -> only match path of req.url
        if (router.match.indexOf('?') < 0) {
            urlRaw = urlPath;
        }

        if ((router.match === urlRaw) || (urlRaw.indexOf(router.match) >= 0) || new RegExp(router.matchResolve).test(urlRaw)) {
            return true;
        }
        return false;
    });
};
