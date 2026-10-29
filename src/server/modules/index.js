'use strict'
// Feature modules. Each registers named operations with app.operation({ name, permission, schema, handler }).
module.exports = [
  require('./auth'),
  require('./shifts'),
  require('./pos'),
  require('./reports'),
  require('./catalog'),
  require('./catalog').registerInventory,
  require('./sales'),
  require('./customers'),
  require('./finance'),
  require('./tills'),
  require('./money'),
  require('./supplierInvoices'),
  require('./purchaseReturns'),
  require('./supplierPayments'),
  require('./stockReports'),
  require('./admin'),
  require('./settings'),
  require('./backup'),
  require('./discounts'),
  require('./sync'),
  require('./categories'),
  require('./measureKinds'),
  require('./storeImport')
]
