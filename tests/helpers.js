'use strict';

var async = require('async');
var path = require('path');
var fs = require('fs');
var url = require('url');
var harness = require('tape-it');
var debug = require('debug');
var path = require('path');
var endsWith = require('endswith');
var cfg = require('./fixtures/cfg');
var nano = require('../lib/nano');
var helpers = exports;

var auth = url.parse(cfg.admin).auth.split(':');

helpers.timeout = cfg.timeout;
helpers.nano = nano(cfg.couch);
helpers.Nano = nano;
helpers.couch = cfg.couch;
helpers.admin = cfg.admin;
helpers.pixel = 'Qk06AAAAAAAAADYAAAAoAAAAAQAAAP////8BABgAAAAA' +
  'AAAAAAATCwAAEwsAAAAAAAAAAAAAWm2CAA==';

helpers.username = auth[0];
helpers.password = auth[1];

helpers.loadFixture = function helpersLoadFixture(filename, json) {
  var contents = fs.readFileSync(
    path.join(__dirname, 'fixtures', filename), (json ? 'ascii' : null));
  return json ? JSON.parse(contents) : contents;
};

helpers.setup = function() {
  var self = this;
  var args = Array.prototype.slice.call(arguments);

  return function(assert) {
    args.push(function(err) {
      assert.equal(err, null, 'create database');
      assert.end();
    });

    self.nano.db.create.apply(this, args);
  };
};

helpers.teardown = function() {
  var self = this;
  var args = Array.prototype.slice.call(arguments);

  return function(assert) {
    args.push(function(err) {
      assert.equal(err, null, 'destroy database');
      assert.ok(self.mock.isDone(), 'mocks didn\'t run');
      assert.end();
    });

    self.nano.db.destroy.apply(this, args);
  };
};

helpers.harness = function(name) {
  var parent = name || module.parent.filename;
  var fileName   = path.basename(parent).split('.')[0];
  var parentDir    = path.dirname(parent)
      .split(path.sep).reverse()[0];
  var shortPath    = path.join(parentDir, fileName);
  var log = debug(path.join('tests', shortPath));
  var dbName       = shortPath.replace('/', '_');
  var nanoLog = nano({
    url: cfg.couch,
    log: log
  });
  var mock = helpers.nock(helpers.couch, shortPath, log);
  var db   = nanoLog.use(dbName);
  var locals = {
    mock: mock,
    db: db,
    nano: nanoLog
  };

  return harness({
    id: shortPath,
    timeout: helpers.timeout,
    checkLeaks: !!process.env.LEAKS,
    locals: locals,
    setup: helpers.setup.call(locals, dbName),
    teardown: helpers.teardown.call(locals, dbName)
  });
};

helpers.nock = function helpersNock(url, fixture, log) {
  var nock = require('nock');
  var nockDefs = require('./fixtures/' + fixture + '.json');

  nockDefs.forEach(function(n) {
    var headers = n.headers || {};
    var response = n.buffer ? endsWith(n.buffer, '.png') ?
        helpers.loadFixture(n.buffer) : new Buffer(n.buffer, 'base64') :
        n.response || '';
    var body = n.base64 ? new Buffer(n.base64, 'base64').toString() :
        n.body || '';

    if (typeof headers === 'string' && endsWith(headers, '.json')) {
      headers = require(path.join(fixture, headers));
    }

    n.method = n.method || 'get';
    n.options = {log: log};
    n.scope = url;
    n.headers = headers;
    n.response = response;
    n.body = body;

    return n;
  });

  nock.define(nockDefs);

  return nock(url);
};

helpers.prepareAView = function(assert, search, db) {
  search = search || '';
  db = db || this.db;

  db.insert({
    views: {
      by_name_and_city: {
        map: 'function(doc) { emit([doc.name, doc.city], doc._id); }'
      }
    },
    lists: {
      'my_list': 'function(head, req) { send(\'Hello\'); }'
    }
  }, '_design/people' + search, function(error, response) {
    assert.equal(error, null, 'should create view');
    assert.equal(response.ok, true, 'response is good');
    async.parallel([
      function(cb) {
        db.insert({
          name: 'Derek',
          city: 'San Francisco'
        }, 'p_derek', cb);
      }, function(cb) {
        db.insert({
          name: 'Randall',
          city: 'San Francisco'
        }, 'p_randall', cb);
      }, function(cb) {
        db.insert({
          name: 'Nuno',
          city: 'London'
        }, 'p_nuno', cb);
      }
    ], function(error) {
      assert.equal(error, undefined, 'store the peeps');
      assert.end();
    });
  });
};

helpers.viewDerek = function viewDerek(db, assert, opts, next, method) {
  method = method || 'view';
  db[method]('people','by_name_and_city', opts, function(error, view) {
    assert.equal(error, null, 'no errors');
    assert.equal(view.rows.length,1);
    assert.equal(view.rows.length,1);
    assert.equal(view.rows[0].id,'p_derek');
    assert.equal(view.rows[0].key[0],'Derek');
    assert.equal(view.rows[0].key[1],'San Francisco');
    next(error);
  });
};

helpers.insertOne = function insertThree(assert) {
  var db = this.db;
  db.insert({'foo': 'baz'}, 'foobaz', function(err) {
    assert.equal(err, null, 'should store docs');
    assert.end();
  });
};

helpers.insertThree = function insertThree(assert) {
  var db = this.db;
  async.parallel([
    function(cb) { db.insert({'foo': 'bar'}, 'foobar', cb); },
    function(cb) { db.insert({'bar': 'foo'}, 'barfoo', cb); },
    function(cb) { db.insert({'foo': 'baz'}, 'foobaz', cb); }
  ], function(error) {
    assert.equal(error, undefined, 'should store docs');
    assert.end();
  });
};

helpers.unmocked = (process.env.NOCK_OFF === 'true');
