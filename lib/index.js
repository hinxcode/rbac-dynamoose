'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _keymirror = require('keymirror');

var _keymirror2 = _interopRequireDefault(_keymirror);

var _rbac = require('rbac');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Type = (0, _keymirror2.default)({
  PERMISSION: null,
  ROLE: null
});

function createSchema(Schema) {
  var schema = new Schema({
    name: { type: String, hashKey: true },
    type: String,
    grants: [String]
  }, {
    throughput: { read: 15, write: 5 }
  });

  return schema;
}

function getType(item) {
  if (item instanceof _rbac.Role) {
    return Type.ROLE;
  } else if (item instanceof _rbac.Permission) {
    return Type.PERMISSION;
  }

  return null;
}

function convertToInstance(rbac, record) {
  if (!record) {
    throw new Error('Record is undefined');
  }

  if (record.type === Type.ROLE) {
    return rbac.createRole(record.name, false, function () {});
  } else if (record.type === Type.PERMISSION) {
    var decoded = _rbac.Permission.decodeName(record.name);
    if (!decoded) {
      throw new Error('Bad permission name');
    }

    return rbac.createPermission(decoded.action, decoded.resource, false, function () {});
  }

  throw new Error('Type is undefined');
}

var DynamooseStorage = function (_Storage) {
  _inherits(DynamooseStorage, _Storage);

  function DynamooseStorage() {
    var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    _classCallCheck(this, DynamooseStorage);

    var _this = _possibleConstructorReturn(this, (DynamooseStorage.__proto__ || Object.getPrototypeOf(DynamooseStorage)).call(this));

    var connection = options.connection;
    if (!connection) {
      throw new Error('Parameter connection is undefined use your current dynamoose connection.');
    }

    options.modelName = options.modelName || 'rbac';
    options.Schema = options.Schema || connection.Schema;

    _this._options = options;

    _this._model = connection.model(options.modelName, createSchema(options.Schema));
    return _this;
  }

  _createClass(DynamooseStorage, [{
    key: 'add',
    value: function add(item, cb) {
      var newInstance = new this.model({
        name: item.name,
        type: getType(item)
      });

      newInstance.save(function (err) {
        if (err) {
          return cb(err);
        }

        cb(null, item);
      });

      return this;
    }
  }, {
    key: 'remove',
    value: function remove(item, cb) {
      var _this2 = this;

      var name = item.name;

      this.model.scan({ grants: { contains: name } }, function (err, records) {
        if (err) {
          return cb(err);
        }

        var promises = [];

        records.forEach(function (r) {
          var asyncFunc = null;

          if (r.grants.length <= 1) {
            asyncFunc = function asyncFunc(resolve, reject) {
              _this2.model.update({ name: r.name }, { $DELETE: { grants: null } }, function (e) {
                if (e) {
                  reject(e);
                }
                resolve();
              });
            };
          } else {
            asyncFunc = function asyncFunc(resolve, reject) {
              _this2.model.update({ name: r.name }, { $PUT: { grants: r.grants.filter(function (g) {
                    return g != name;
                  }) } }, function (e) {
                if (e) {
                  reject(e);
                }
                resolve();
              });
            };
          }

          promises.push(new Promise(asyncFunc));
        });

        Promise.all(promises).catch(function (e) {
          return cb(e);
        }).then(function () {
          _this2.model.delete({ name: name }, function (err2) {
            if (err2) {
              return cb(err2);
            }

            cb(null, true);
          });
        });
      });

      return this;
    }
  }, {
    key: 'grant',
    value: function grant(role, child, cb) {
      var _this3 = this;

      var name = role.name;
      var childName = child.name;

      if (!role instanceof _rbac.Role) {
        return cb(new Error('Role is not instance of Role'));
      }

      if (name === childName) {
        return cb(new Error('You can grant yourself'));
      }

      this.model.queryOne({ name: { eq: name }, type: { eq: Type.ROLE } }, function (err, record) {
        if (err) {
          return cb(err);
        }

        if (!record.grants) {
          _this3.model.update({ name: name, type: Type.ROLE }, { grants: [childName] }, function (err) {
            if (err) {
              return cb(err);
            }

            cb(null, true);
          });
        } else {
          _this3.model.update({
            name: name,
            type: Type.ROLE
          }, {
            grants: record.grants.filter(function (g) {
              return g != childName;
            }).concat([childName])
          }, function (err2) {
            if (err2) {
              return cb(err2);
            }

            cb(null, true);
          });
        }
      });

      return this;
    }
  }, {
    key: 'revoke',
    value: function revoke(role, child, cb) {
      var _this4 = this;

      var name = role.name;
      var childName = child.name;

      this.model.queryOne({ name: { eq: name }, type: { eq: Type.ROLE } }, function (err, record) {
        if (err) {
          return cb(err);
        }

        _this4.model.update({ name: name, type: Type.ROLE }, { grants: record.grants.filter(function (g) {
            return g != childName;
          }) }, { allowEmptyArray: true }, function (err2) {
          if (err2) {
            return cb(err2);
          }

          cb(null, true);
        });
      });

      return this;
    }
  }, {
    key: 'get',
    value: function get(name, cb) {
      var rbac = this.rbac;

      this.model.queryOne({ name: { eq: name } }, function (err, record) {
        if (err) {
          return cb(err);
        }

        if (!record) {
          return cb(null, null);
        }

        cb(null, convertToInstance(rbac, record));
      });

      return this;
    }
  }, {
    key: 'getRoles',
    value: function getRoles(cb) {
      var rbac = this.rbac;

      this.model.query({ type: { eq: Type.ROLE } }, function (err, records) {
        if (err) {
          return cb(err);
        }

        var instances = records.map(function (r) {
          return convertToInstance(rbac, r);
        });

        cb(null, instances);
      });

      return this;
    }
  }, {
    key: 'getPermissions',
    value: function getPermissions(cb) {
      var rbac = this.rbac;

      this.model.query({ type: { eq: Type.PERMISSION } }, function (err, records) {
        if (err) {
          return cb(err);
        }

        var instances = records.map(function (r) {
          return convertToInstance(rbac, r);
        });

        cb(null, instances);
      });

      return this;
    }
  }, {
    key: 'getGrants',
    value: function getGrants(role, cb) {
      var _this5 = this;

      var rbac = this.rbac;

      this.model.queryOne({ name: { eq: role }, type: { eq: Type.ROLE } }, function (err, record) {
        if (err) {
          return cb(err);
        }

        if (!record || !record.grants) {
          return cb(null, []);
        }

        _this5.model.scan({ name: { in: record.grants } }, function (err2, records) {
          if (err2) {
            return cb(err2);
          }

          var instances = records.map(function (r) {
            return convertToInstance(rbac, r);
          });

          cb(null, instances);
        });
      });

      return this;
    }
  }, {
    key: 'model',
    get: function get() {
      return this._model;
    }
  }, {
    key: 'options',
    get: function get() {
      return this._options;
    }
  }]);

  return DynamooseStorage;
}(_rbac.Storage);

exports.default = DynamooseStorage;