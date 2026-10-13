'use strict'
// Feature modules. Each registers named operations with app.operation({ name, permission, schema, handler }).
module.exports = [require('./auth'), require('./shifts'), require('./pos')]
