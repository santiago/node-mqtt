var EventEmitter= require('events').EventEmitter;
var MessageType= require('./mqtt-domain').MessageType;
var FixedHeader= require('./mqtt-domain').FixedHeader;

// Interface for authenticating against black-box backend
// For now we're using MongoDB optimized for caching
function Authenticate(data) {
    return data.username=="santiago"&&data.password=="santiago";
}

function parseLength(client) {
    var client= this;

    /* Calculate the length of the packet */
    var length = 0;
    var mul = 1;
    
    /* TODO: move calculating the length into a utility function */
    for(var i = 1; i < client.buffer.length; i++) {
	length += (client.buffer[i] & 0x7F) * mul;
	mul *= 0x80;

	if(i > 5) {
	    /* Length field too long */
	    sys.log("Error: length field too long");
	    client.emit('error', "Length field too long");
	    return false;
	}

	/* Reached the last length byte */
	if(!(client.buffer[i] & 0x80)) {
	    return { fixed:(1+i), remaining:length, total:(1+i+length) };
	}
    }
    return false;
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

    ({
        'CONNECT': function() {
	    var count = 0;
	    // Gets lenght when its called.
	    // This a closure that increments 'count' and reads 'data'
	    function getLength() {
		// Get MSB and multiply by 256
		var l= data.body[count++] << 8;
		// Most likely the byte isn't there
		if(isNaN(l)||l===undefined) {
		    return false;
		}
		// Get LSB and sum to MSB
		return l += data.body[count++];
	    }

	    var version = "\00\06MQIsdp\03";
	    if(data.body.slice(count, count+version.length).toString('utf8') !== version) {
		sys.log('Invalid version');
		client.connack(1);
		return;
	    }

	    /* Skip the version field */
	    count += version.length;

	    /* Extract the Connect Flags  */
	    data.willRetain= (data.body[count] & 0x20 != 0);
	    data.willQos= (data.body[count] & 0x18) >> 3;
	    data.willFlag= (data.body[count] & 0x04 != 0);
	    data.cleanSession= (data.body[count] & 0x02 != 0);
	    /* Check for Username and Passord Flags */
	    var hasUsername= data.body[count] >> 7 == 1;
	    var hasPassword= data.body[count] >> 6 == 3;

	    // For now we're not allowing anonymous connections
	    if(!hasUsername || !hasPassword) {
		client.connack(5);
		return;
	    }

	    count++;

	    /* Extract the keepalive */
	    data.keepalive= data.body[count++] << 8;
	    data.keepalive += data.body[count++];
	    // TODO: Set keepAlive as timeout somewhere within the client object

	    /* Extract the client ID length */
	    var clientLen= getLength();
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
	    data.clientId= data.body.slice(count, count+clientLen).toString('utf8');
	    count += clientLen;

	    // Extract the will topic/message
	    if(data.willFlag) {
		// Calculate the length of the topic string
		var topicLen= getLength();

		// Cut the topic string out of the buffer
		data.willTopic= data.body.slice(count, count+topicLen).toString('utf8');
		// Move the pointer to after the topic string
		count += topicLen;

		// What remains in the body is will message 
		data.willMessage= data.body.slice(count, data.body.length);
	    }

	    // Extract username and password ...
	    // Calculate the length of the username
	    var usernameLen= getLength();

	    // username not present in payload
	    if(!usernameLen) {
		client.connack(4);
		return;
	    }

	    // Extract username
	    data.username= data.body.slice(count, count+usernameLen).toString('utf8');
	    count += usernameLen;

	    // Calculate the length of the password
	    var passwordLen= getLength();
	    // password not present in payload
	    if(!passwordLen) {
		client.connack(4);
		return;
	    }
	    // Extract password
	    data.password= data.body.slice(count, count+passwordLen).toString('utf8');
	    count += passwordLen;

	    // Authenticate
	    if(!Authenticate(data)) {
	    	client.connack(4);
	    }

	    // Everything went a'right, acknowledge connection
	    emit({ command: MessageType.CONNACK, code: code });
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

	    data.topic= data.body.slice(_count, _count+topicLen).toString('utf8');
	    _count += topicLen;

	    var messageId= getMessageId();

	    // Extract payload ...
	    var chunkLen, payload="";
	    do {
		chunkLen= _getLength()
		payload += data.body.slice(_count, _count+chunkLen).toString('utf8');
		_count += chunkLen;
	    } while (chunkLen==65535)

	    // QoS 1, emit PUBACK
	    if(data.qos==1) {
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

	    // Fixed Header QoS should be 1; otherwise, send SUBACK anyway
	    // and return
	    if(data.qos!==1) {
		client.emit(MessageType.SUBACK, MessageID);
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
		topics.push(topic);
		client.subscriptions.push(topic.name);
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
	    // client.socket.end();
	}
    })[cmd]();
}

var sys= require('sys');
var net = require("net");
var EventEmitter= require('events').EventEmitter;

function MQTTClient(socket) {
    this.clientID= '';
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

MQTTClient.prototype.read= function(data) {
    var client= this;

    // Accumulate incoming data
    var newSize= client.buffer.length + data.length;
    var newBuf= new Buffer(newSize);
    client.buffer.copy(newBuf);
    data.copy(newBuf, client.buffer.length);
    client.buffer= newBuf;

    // If next packet is taking too long
    client.timeout= setTimeout(function(client) {
	// sys.log('Discarding incomplete packet');
	// sys.log(++client.discarded);
	// client.emit('error', "Discarding incomplete packet");
	return;
    }, 5000, this);

    while(client.buffer.length) {
	var length= parseLength.call(client);
	if(!length) { break }

	if(client.buffer.length < length.total) {
	    break;
	}

	// Cut the current packet out of the buffer
	var packet= client.buffer.slice(0, length.total);
	var event= {
	    command: (packet[0] & 0xF0) >> 4,
	    dup: ((packet[0] & 0x08) == 0x08),
	    qos: (packet[0] & 0x06) / 2, 
	    retain: ((packet[0] & 0x01) != 0),
	    body: packet.slice(length.fixed, length.total)
	};
	client.emit(event.command, event);
	// client.pause= false;

	// We've got a complete packet, stop the incomplete packet timer
	clearTimeout(client.timeout);

	// Remove current packet from buffer
	client.buffer= client.buffer.slice(length.total);
    }
};

function MQTTServer() {
    this.server= net.createServer();
    var self= this;
    this.server.on('connection', function(socket) {
	sys.log("Connection from " + socket.remoteAddress);
	client= new MQTTClient(socket);
	self.emit('new_client', client);
    });
}
sys.inherits(MQTTServer, EventEmitter);

var s= new MQTTServer();
s.server.listen(1883, "::1");
