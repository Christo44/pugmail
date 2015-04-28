/**
 * Module Dependencies
 */

var debug = require('debug')('jademail');
var consolidate = require('consolidate');
var superagent = require('superagent');
var prettyjson = require('prettyjson');
var inline = require('inline-styles');
var delegates = require('delegates');
var extend = require('extend.js');
var yieldly = require('yieldly');
var subs = require('subs');
var path = require('path');
var dirname = path.dirname;
var extname = path.extname;

var litmusTest = '';
if (process.env.NODE_ENV != 'production') {
  litmusTest = ""
}
litmusTest = litmusTest.split(', ');

/**
 * API endpoint
 */

var api = 'https://mandrillapp.com/api/1.0/messages/send.json';

/**
 * Export `mandrill`
 */

module.exports = function(key) {
  return new Email(key);
}

/**
 * Initialize `Email`
 */

function Email(key) {
  if (!(this instanceof Email)) return new Email(key);
  this.key = key;
  this.messages = [];
}

/**
 * Create a new Message
 */

Email.prototype.message = function(attrs) {
  var message = new Message(attrs, this);
  this.messages.push(message);
  return message;
};

/**
 * Send all the messages
 */

Email.prototype.send = yieldly(function(fn) {
  console.error('WARNING: Email.prototype.send is not implemented!');
});

/**
 * Initialize `Message`
 */

function Message(attrs, email) {
  if (!(this instanceof Message)) return new Message(attrs);
  this.opts = {};
  this.attrs = {};
  this.locals = {};
  this.key = email.key;
  this.sent = false;

  // arrays
  this.attrs.to = [];
  this.attrs.tags = [];

  // defaults
  this.attrs.inline_css = true;
  this.attrs.track_opens = true;
  this.attrs.track_clicks = true;
  this.attrs.preserve_recipients = null;
  this.attrs.headers = {
    "Content-Type": "text/html; charset=\"UTF-8\""
  }

  if (attrs) this.set(attrs);
}

/**
 * Delegate to attrs
 */

delegates(Message.prototype, 'attrs')
  .fluent('subject')
  .fluent('html')

delegates(Message.prototype, 'opts')
  .fluent('template')
  .fluent('dryrun')

/**
 * locals
 */

Message.prototype.local = function(key, value) {
  'object' == typeof key
    ? this.locals = extend(this.locals, key)
    : this.locals[key] = value;

  return this;
};

/**
 * to
 */

Message.prototype.to = function(to) {
  if (!arguments.length) return this;
  to = 'string' == typeof to ? [to] : to;
  this.attrs.to = this.attrs.to.concat(to.map(parse));
  return this;
};

/**
 * from
 */

Message.prototype.from = function(from) {
  from = parse(from);
  this.attrs.from_email = from.email;
  this.attrs.from_name = from.name;
  return this;
};

/**
 * plaintext template
 */

Message.prototype.altText = function(template) {
  if (!template) return this.plaintextTemplate;
  this.plaintextTemplate = template;
  return this;
}

/**
 * tag
 */

Message.prototype.tag = function(tag) {
  tag = 'string' == typeof tag ? [tag] : tag;
  this.attrs.tags = this.attrs.tags.concat(tag);
  return this;
};

/**
 * set
 */

Message.prototype.set = function(obj) {
  for (var k in obj) {
    if ('function' == typeof this[k]) this[k](obj[k]);
    else this.attrs[k] = obj[k];
  }

  return this;
};

/**
 * send
 */

Message.prototype.send = yieldly(function(fn) {
  this.attrs = this.substitute(this.attrs, this.locals);

  if (litmusTest && litmusTest.length > 0) {
    var self = this;
    litmusTest.forEach(function(email) {
      if (email != '') self.to(email);
    })
  }

  if (!this.template()) return this.sendHTML(fn);

  var self = this;
  resolveTemplate(this.template(), this.locals, function(err, html) {
    if (err) return fn(err);
    // TODO: replace with an async version
    html = html.toString()
    self.attrs.html = html;
    self.sendHTML(fn);
  });
});

/**
 * sendContent
 */

Message.prototype.sendHTML = function(fn) {
  var self = this;
  if (this.altText()) {
    resolveTemplate(this.altText(), this.locals, function(err, text) {
      if (err) return fn(err);
      text = text.toString();
      self.attrs.text = text;
      sendFinal();
    })
  }
  else {
    sendFinal();
  }

  function sendFinal() {
    debug('sending\n%s', prettyjson.render(self.attrs));
    if (self.dryrun()) {
      debug('dryrun result: \n%s', prettyjson.render(self.attrs));
      return;
    } else if (self.sent) {
      debug('already sent!');
      return;
    }
    superagent.post(api)
      .send({ key: self.key, message: self.attrs })
      .end(function(err, res) {
        if (err) return fn(err);
        else if (res.ok) {
          // TODO: Response status might be ok, but body will indicate status='invalid' if
          //       cannot send. Need to handle this as an error condition.
          self.sent = true;
          return fn(null, res.body);
        }
        var error = new Error('Mandrill response status ' + res.status);
        error.data = res.body;
        debug("Mandrill Error: [%s] %s", res.status, JSON.stringify(res.body));
        return fn(error);
      });
  }
  return this;
};

/**
 * substitute
 */

Message.prototype.substitute = function(attrs, locals) {
  // to
  for (var i = 0, to; to = attrs.to[i]; i++) {
    if (to.name) attrs.to[i].name = subs(to.name, locals);
    if (to.email) attrs.to[i].email = subs(to.email, locals);
  }

  // from
  if (attrs.from_email) attrs.from_email = subs(attrs.from_email, locals);
  if (attrs.from_name) attrs.from_name = subs(attrs.from_name, locals);

  // subject
  if (attrs.subject) attrs.subject = subs(attrs.subject, locals);

  return attrs;
};

/**
 * toString
 */

Message.prototype.toString = function() {
  return JSON.stringify(this.attrs, true, 2);
};

/**
 * Resolve template
 */

function resolveTemplate(template, locals, fn) {
  var ext = extname(template).slice(1);
  var dir = dirname(template);
  consolidate[ext](template, locals, fn);
}

/**
 * Parses "A B <c@d.com>" into mandrill {email,name} format.
 *
 * @param {Object|String} email
 * @return {Object}
 * @api private
 */

function parse(email){
  if ('object' == typeof email) {
    return email;
  } else if (~email.indexOf('<')) {
    var match = email.match(/(.*) <([^>]+)>/);
    return { name: match[1], email: match[2] };
  } else {
    return { email: email };
  }
}
