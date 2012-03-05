var EventEmitter= require('events').EventEmitter;
var Domain= require('./mqtt-domain');
var MessageType= Domain.MessageType;
var FixedHeader= Domain.FixedHeader;
var encodeLength= Domain.encodeLength;

var __topics= {};

function Topic(topic) {
    return {
	subscribe: function(clientId, qos) {
	    if(!__topics[topic]) { __topics[topic]= {} }
	    __topics[topic][clientId]= qos;
	},
	unsubscribe: function(clientId) {
	    delete __topics[topic][clientId];
	},
	publish: function(clientId, message) {
	    for(clientId in __topics[topic]) {
		mqtt.getClient(clientId).publish(message);
	    }
	}
    }
}

// Interface for authenticating against black-box backend
// For now we're using MongoDB optimized for caching
function Authenticate(data) {
    return data.username=="santiago"&&data.password=="santiago";
}

function callCommand(client, cmd, data) {
    var _count = 0;

    function _getLength() {
	// Get MSB and multiply by 256
	var l= data.body[_count++] << 8;

	// Most likely the byte isn't there
	if(isNaN(l)||l===undefined) {
	    return false;
	}
	// Get LSB and sum to MSB
	return l += data.body[_count++];
    }

    function getMessageId() {
	var messageId= _getLength();
	return [messageId/256|0, messageId%256];
    }

    function emit(event) {
	client.emit(event.command, event);
    }

    function getPayload() {
	// Extract payload ...
	var chunkLen, payload="";
	do {
	    chunkLen= _getLength()
	    payload += data.body.slice(_count, _count+chunkLen).toString('utf8');
	    _count += chunkLen;
	} while (chunkLen==65535)

	return payload;
    }

    ({
        'CONNECT': function() {
	    var version = "\00\06MQIsdp\03";
	    if(data.body.slice(_count, _count+version.length).toString('utf8') !== version) {
		sys.log('Invalid version');
		client.connack(1);
		return;
	    }

	    /* Skip the version field */
	    _count += version.length;

	    /* Extract the Connect Flags  */
	    data.willRetain= (data.body[_count] & 0x20 != 0);
	    data.willQos= (data.body[_count] & 0x18) >> 3;
	    data.willFlag= (data.body[_count] & 0x04 != 0);
	    data.cleanSession= (data.body[_count] & 0x02 != 0);
	    /* Check for Username and Passord Flags */
	    var hasUsername= data.body[_count] >> 7 == 1;
	    var hasPassword= data.body[_count] >> 6 == 3;

	    // For now we're not allowing anonymous connections
	    if(!hasUsername || !hasPassword) {
		client.connack(5);
		return;
	    }

	    _count++;

	    /* Extract the keepalive */
	    data.keepalive= data.body[_count++] << 8;
	    data.keepalive += data.body[_count++];
	    // TODO: Set keepAlive as timeout somewhere within the client object

	    /* Extract the client ID length */
	    var clientLen= _getLength();
	    if(!clientLen||clientLen>23) {
		console.log("0x02 Connection Refused: identifier rejected");
		// 0x02 connection Refused: identifier rejected
		client.connack(2);
		return;
	    }

	    /* Is our client ID length reasonable? */
	    if(clientLen > data.body.length) {
		/* Just in case our client ID length is too long */
		/* TODO: make some proper error objects or messages */
		/* TODO: and handle this better rather than just dropping everything */
		client.emit('error', "Protocol error - client ID length");
		return;
	    }

	    /* Extract client ID */
	    data.clientId= data.body.slice(_count, _count+clientLen).toString('utf8');
	    _count += clientLen;

	    // Extract the will topic/message
	    if(data.willFlag) {
		// Calculate the length of the topic string
		var topicLen= _getLength();

		// Cut the topic string out of the buffer
		data.willTopic= data.body.slice(_count, _count+topicLen).toString('utf8');
		// Move the pointer to after the topic string
		_count += topicLen;

		// What remains in the body is will message 
		data.willMessage= data.body.slice(_count, data.body.length);
	    }

	    // Extract username and password ...
	    // Calculate the length of the username
	    var usernameLen= _getLength();

	    // username not present in payload
	    // if(!usernameLen) {
	    // 	client.connack(4);
	    // 	return;
	    // }

	    // Extract username
	    if(usernameLen) {
		data.username= data.body.slice(_count, _count+usernameLen).toString('utf8');
		_count += usernameLen;
	    }

	    // Calculate the length of the password
	    var passwordLen= _getLength();
	    // password not present in payload
	    if(!passwordLen) {
		client.connack(4);
		return;
	    }
	    // Extract password
	    data.password= data.body.slice(_count, _count+passwordLen).toString('utf8');
	    _count += passwordLen;

	    // Authenticate
	    if(!Authenticate(data)) {
	    	client.connack(4);
		return;
	    }

	    // Everything went a'right, acknowledge connection
	    client.connack(0);
        },
	// Send CONNACK message
	'CONNACK': function() {
	    var fh= FixedHeader(MessageType.CONNACK, 0, 0, 0);
	    var vh= [0x00,data.code];
	    var length= vh.length;
	    client.socket.write(new Buffer(fh.concat(length).concat(vh)));
	},
	'PUBLISH': function() {
	    // Extract topic ...
	    var topicLen= _getLength();
	    // topic not present in Variable Header
	    if(!topicLen) {
		return;
	    }
	    var topic= data.body.slice(_count, _count+topicLen).toString('utf8');
	    _count += topicLen;

	    var messageId= getMessageId();

	    // QoS 0
	    if(data.qos==0) {
		Topic(topic).publish(data);
	    }
	    // QoS 1, emit PUBACK
	    if(data.qos==1) {
		Topic(topic).publish(client.cliendId, data);
		emit({ command: MessageType.PUBACK, messageId: messageId });
	    }
	    // QoS 2, emit PUBREC
	    if(data.qos==2) {
		emit({ command: MessageType.PUBREC, messageId: messageId });
	    }
	},
	'PUBACK': function() {
	    var msg= FixedHeader(MessageType.PUBACK, 0, 0, 0);
	    msg= msg.concat([2]).concat(data.messageId); // Remaining Length + MessageID
	    client.socket.write(new Buffer(msg));
	},
	'PUBREC': function() {
	    var msg= FixedHeader(MessageType.PUBREC, 0, 0, 0);
	    msg= msg.concat([2]).concat(data.messageId); // Remaining Length + MessageID
	    client.socket.write(new Buffer(msg));
	},
	'PUBREL': function() {
	    emit({ command: MessageType.PUBCOMP, messageId: getMessageId() });
	},
	'PUBCOMP': function() {
	    var msg= FixedHeader(MessageType.PUBCOMP, 0, 0, 0);
	    msg= msg.concat([2]).concat(data.messageId); // Remaining Length + MessageID
	    client.socket.write(new Buffer(msg));
	},
	'SUBSCRIBE': function() {
	    // If there's no Message ID do nothing
	    var MessageID= getMessageId();
	    if(!MessageID) {
		return false;
	    }

	    // Extract the topic(s)
	    var topics= [];
	    while(data.body[_count]!==undefined) {
		var length= _getLength();
		_count += length;
		var topic= {
		    name: data.body.slice(_count-length, _count).toString('utf8'),
		    qos: data.body.slice(_count++,_count).toString('utf8')
		};
		Topic(topic.name).subscribe(client.clientId, data.qos);
		client.subscriptions.push(topic.name);
		topics.push(topic);
	    }

	    // Emit SUBACK
	    var event= {
		command: MessageType.SUBACK,
		MessageID: MessageID,
		topics: topics
	    };
	    emit(event);
	},
	'SUBACK': function() {
	    var fh= FixedHeader(MessageType.SUBACK, 0, 0, 0);
	    var length= 2; // 2 MessageID bytes
	    var MessageID= data.MessageID;

	    var topics= data.topics.map(function(t) {
		return t.qos;
	    });
	    length += topics.length;
	    client.socket.write(new Buffer(fh.concat(length).concat(MessageID).concat(topics)));
	},
	'UNSUBSCRIBE': function() {
	    // If there's no Message ID do nothing
	    var messageId= getMessageId();
	    if(!messageId) {
		return false;
	    }

	    // Extract the topic(s)
	    var topics= [];
	    while(data.body[_count]!==undefined) {
		var length= _getLength();
		_count += length;
		var topic= data.body.slice(_count-length, _count).toString('utf8');

		// Remove this topic from client
		var index= client.subscriptions.indexOf(topic);
		client.subscriptions.splice(index, 1);

		// Inject
		Topic(topic).unsubscribe(client.clientId);
	    }

	    emit({ command: MessageType.UNSUBACK, messageId: messageId});
	},
	'UNSUBACK': function() {
	    var fh= FixedHeader(MessageType.UNSUBACK, 0, 0, 0);
	    var length= 2; // 2 MessageID bytes
	    var messageId= data.messageId;
	    client.socket.write(new Buffer(fh.concat(length).concat(messageId)));
	},
	'PINGREQ': function() {
	    emit({ command: MessageType.PINGRESP });
	},
	'PINGRESP': function() {
	    var fh= FixedHeader(MessageType.PINGRESP, 0, 0, 0);
	    client.socket.write(new Buffer(fh.concat([0]))); // Remaining Lenght is 0
	},
	'DISCONNECT': function() {
	    client.disconnect();
	}
    })[cmd]();
}

var sys= require('sys');
var net = require("net");
var EventEmitter= require('events').EventEmitter;

function MQTTClient(socket, clientId) {
    this.clientId= clientId;
    this.socket= socket;
    this.buffer= new Buffer(0);
    this.subscriptions= [];

    var self= this;

    this.count= 0;
    this.discarded= 0;

    var commands= ['CONNECT','CONNACK','PUBLISH','PUBACK','PUBREC','PUBREL','PUBCOMP','SUBSCRIBE','SUBACK','UNSUBSCRIBE','UNSUBACK','PINGREQ','PINGRESP','DISCONNECT'];
    commands.forEach(function(e) {
        self.on(MessageType[e], function(data) { callCommand(self, e, data) });
    });

    this.on('error', function() {
	// Discard current packet
	this.buffer= new Buffer(0);
    });

    this.socket.on('data', function(data) {
	self.read(data);
    });

    this.socket.on('error', function(exception) {
	self.emit('error', exception);
    });

    this.socket.on('close', function(had_error) {
	self.emit('close');
    });
}
sys.inherits(MQTTClient, EventEmitter);

MQTTClient.prototype.read= Domain.parser;

MQTTClient.prototype.connack= function(code) {
    var event= {
	command: MessageType.CONNACK,
	code: code
    };
    this.emit(event.command, event);
};


MQTTClient.prototype.publish= function(data) {
    var self= this;

    var fh= FixedHeader(MessageType.PUBLISH, 0, data.qos, 0);
    var length= encodeLength(data.body.length);

    try {
	this.socket.write(new Buffer(fh.concat(length)));
	this.socket.write(data.body);
    } catch(e) {
	// Most likely it tried to write to a closed connection
	// Shouldn't happen!!!

	// Remove this cliendId from the topics it subscribed
	this.disconnect();
	console.log(e);
    }
};

MQTTClient.prototype.disconnect= function() {
    var self= this;
    this.socket.end();
    this.subscriptions.forEach(function(topic) {
	Topic(topic).unsubscribe(self.clientId);
    });
    self.emit('destroy');
};

function MQTTServer() {
    var nextClientId= 1;
    var nextMessageId= 1;
    var clients= {};

    this.server= net.createServer();

    this.getClient= function(clientId) {
	return clients[clientId];
    };

    var self= this;
    this.server.on('connection', function(socket) {
	sys.log("Connection from " + socket.remoteAddress);

	var clientId= nextClientId;
	clients[clientId]= new MQTTClient(socket, nextClientId++);
	clients[clientId].on('destroy', function() {
	    console.log("Killing client "+clientId);
	    delete clients[clientId];
	});

	self.emit('new_client', clients[nextClientId]);
    });
}
sys.inherits(MQTTServer, EventEmitter);

var mqtt= new MQTTServer();
mqtt.server.listen(1883, "::1");
