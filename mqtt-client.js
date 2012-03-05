var EventEmitter= require('events').EventEmitter;
var sys= require('sys');
var net= require('net');

var Domain= require('./mqtt-domain');
var FixedHeader= Domain.FixedHeader;
var MessageType= Domain.MessageType;
// Utils
var encodeLength= Domain.encodeLength;
var chunker= Domain.chunker;
var utf8StringBuffer= Domain.utf8StringBuffer;
var decode256= Domain.decode256;

var VERSION= Domain.VERSION;

var Client= function(opts) {
    var self= this;
    opts= opts ? opts : {};

    this.host= opts.host||"::1";
    this.port= opts.port||1883;

    this.username= opts.username;
    this.password= opts.password;
    this.clientId= opts.clientId;

    this.socket= new net.Socket(); 
    this.socket.connect(1883, "::1");

    this.buffer= new Buffer(0);

    var callCommand= Domain.parseCommand;

    var commands= ['CONNECT','CONNACK','PUBLISH','PUBACK','PUBREC','PUBREL','PUBCOMP','SUBSCRIBE','SUBACK','UNSUBSCRIBE','UNSUBACK','PINGREQ','PINGRESP','DISCONNECT'];
    commands.forEach(function(e) {
        self.on(MessageType[e], function(data) { callCommand(self, e, data) });
    });

    this.socket.on('connect', function() {
	self.socket.on('data', function(data) {
	    self.read(data);
	});
	self.connect();
    });

    var nextMessageId= 1;
    this.nextMessageId= function() {
	return new Buffer([nextMessageId/256|0, nextMessageId++%256]);
    }
}
sys.inherits(Client, EventEmitter);

Client.prototype.connect= function() {
    if(this.connected) {
	return;
    }

    // Fixed Header
    var FLAGS= 3 << 6;
    var fh= FixedHeader(MessageType.CONNECT, 0, 0, 0);
    var vh= VERSION.concat([FLAGS,0,0x0A]);
    var length= vh.length;
    
    // Get clientID
    var clientID= this.clientId || function() {
	var crypto= require('crypto');
	var hash= crypto.createHash('sha1');
	hash.update(Date()+Math.random());
	return hash.digest('base64').slice(0,23);
    }();

    if(clientID!==undefined) { 
	clientID= new Buffer(clientID); 
	length += clientID.length+2;
    }

    if(this.username!==undefined) {
	var username= new Buffer(this.username);
	length += username.length+2;
    }
    
    if(this.password!==undefined) {
	var password= new Buffer(this.password);
	length += password.length+2;
    }
    
    this.socket.write(new Buffer(fh.concat(length).concat(vh)));
    
    // Push clientID into stream
    if (clientID!==undefined) {
	this.socket.write(new Buffer([0x00,clientID.length]));
	if(clientID.length) { this.socket.write(clientID); }
    }
    
    // Push username into stream
    if (username!==undefined) { 
	this.socket.write(new Buffer([0x00,username.length]));
	this.socket.write(username);
    }
    // Push password into stream
    if (password!==undefined) { 
	this.socket.write(new Buffer([0x00,password.length]));
	this.socket.write(password);
    }

    var self= this;
    this.socket.on(MessageType.CONNACK, function() {
	self.connected= true;	
    });
};

Client.prototype.disconnect= function() {
    var fh= FixedHeader(MessageType.DISCONNECT, 0, 0, 0);
    this.socket.write(new Buffer(fh.concat([0])));
    this.socket.end();
};

Client.prototype.subscribe= function(topics) {
    // Expecting Array
    if(!(topics instanceof Array)) {
	throw("I'm expecting an Array of topics!");
    }

    var self= this;

    var fh= FixedHeader(MessageType.SUBSCRIBE, 0, 1, 0);
    var vh= this.nextMessageId(); // Message ID
    var length= vh.length;

    topics.forEach(function(_topic) {
	var topic= new Buffer(_topic[0]);
	length += topic.length+3;
    });
	    
    // Write message
    this.socket.write(new Buffer(fh.concat(length)));
    this.socket.write(vh);
    topics.forEach(function(_topic) {
	self.socket.write(new Buffer([0x00,_topic[0].length]));
	self.socket.write(new Buffer(_topic[0].toString()));
	self.socket.write(new Buffer(_topic[1].toString()));
    });
};

Client.prototype.unsubscribe= function() {
};

Client.prototype.publish= function(topic, buf) {
    var self= this;

    var fh= FixedHeader(MessageType.PUBLISH, 0, 1, 0);

    var topic= utf8StringBuffer(new Buffer(topic));
    var messageId= this.nextMessageId();
    var chunked= chunker(buf);
    var length= encodeLength(topic.length+messageId.length+(buf.length+chunked.length*2));

    // Write Fixed Header
    this.socket.write(new Buffer(fh.concat(length)));
    // Write Variable Header
    this.socket.write(topic);
    this.socket.write(messageId);
    // Write chunked Payload
    chunked.forEach(function(chunk) {
	self.socket.write(utf8StringBuffer(chunk));
    });
	    
    return decode256(messageId);
};

Client.prototype.read= Domain.parser;

module.exports= Client;