/**
 * Module Dependencies
 */

var Email = module.exports = require('./mandrill')(process.env.MANDRILL_API_TOKEN);
