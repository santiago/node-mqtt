var EventEmitter= require('events').EventEmitter;
var MessageType= require('./mqtt-domain').MessageType;
var FixedHeader= require('./mqtt-domain').FixedHeader;

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

function callEvent(client, event, data) {
    ({
        'CONNECT': function() {
	    var count = 0;
	    sys.log(++client.count);
	    var version = "\00\06MQIsdp\03";
	    if(data.body.slice(count, count+version.length).toString('utf8') !== version) {
		sys.log('Invalid version');
		client.emit('error', '0x01 Connection Refused: unacceptable protocol version');
	    }

	    /* Skip the version field */
	    count += version.length;

	    /* Extract the Connect Flags  */
	    data.willRetain= (data.body[count] & 0x20 != 0);
	    data.willQos= (data.body[count] & 0x18) >> 3;
	    data.willFlag= (data.body[count] & 0x04 != 0);
	    data.cleanSession= (data.body[count] & 0x02 != 0);

	    count++;

	    /* Extract the keepalive */
	    data.keepalive= data.body[count++] << 8;
	    data.keepalive += data.body[count++];

	    /* Extract the client ID length */
	    var clientLen= data.body[count++] * 256;
	    if(isNaN(clientLen)) {
		console.log("0x02 Connection Refused: identifier rejected");
		// 0x02 Connection Refused: identifier rejected
		var event= {
		    command: MessageType.CONNACK
		};
		this.emit(event.command, event);
		return;
	    }
	    clientLen += data.body[count++];

	    /* Is our client ID length reasonable? */
	    if(clientLen > data.body.length) {
		/* Just in case our client ID length is too long */
		/* TODO: make some proper error objects or messages */
		/* TODO: and handle this better rather than just dropping everything */
		this.emit('error', "Protocol error - client ID length");
		return;
	    }

	    /* Extract client ID */
	    data.clientId= data.body.slice(count, count+clientLen).toString('utf8');
	    count += clientLen + 2;

	    /* Check for Username and Passord Flags */
	    var hasUsername= data.body[count] >> 7 != 0;
	    var hasPassword= data.body[count] >> 6 != 0;

	    if(!hasUsername || !hasPassword) {
		var event= {
		    command: MessageType.CONNACK,
		    code: 5,
		    message: "0x05 Connection Refused: not authorized",
		    clientID: data.clientID
		};
		client.emit(event.command, event);
		return;
	    }

	    /* Extract the will topic/message */
	    if(data.willFlag) {
		/* Calculate the length of the topic string */
		var topicLen= data.body[count++] << 8;
		topicLen += data.body[count++];
		/* Cut the topic string out of the buffer */
		data.willTopic= data.body.slice(count, count+topicLen).toString('utf8');
		/* Move the pointer to after the topic string */
		count += topicLen;

		/* What remains in the body is will message */
		data.willMessage= data.body.slice(count, data.body.length);
	    }
	    
	    /* Clear the body as to not confuse the guy on the other end */
	    delete data.body;

	    // this.emit('connect', packet);
        },
	// Send CONNACK message
	'CONNACK': function() {
	    var fh= FixedHeader(MessageType.CONNACK, 0, 0, 0);
	    var vh= [0x00,data.code];
	    var length= vh.length;
	    client.socket.write(new Buffer(fh.concat(length).concat(vh)));
	}
    })[event]();
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

    var events= ['CONNECT','CONNACK','PUBLISH','PUBACK','PUBREC','PUBREL','PUBCOMP','SUBSCRIBE','SUBACK','UNSUBSCRIBE','UNSUBACK','PINGREQ','PINGRESP','DISCONNECT'];
    events.forEach(function(e) {
        self.on(MessageType[e], function(data) { callEvent(self, e, data) });
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
    console.log(data);

    var client= this;

    // Accumulate incoming data
    var newSize= client.buffer.length + data.length;
    var newBuf= new Buffer(newSize);
    client.buffer.copy(newBuf);
    data.copy(newBuf, client.buffer.length);
    client.buffer= newBuf;

    // if(client.pause) { return; }
    // client.pause= true;

    // If next packet is taking too long
    client.timeout= setTimeout(function(client) {
	sys.log('Discarding incomplete packet');
	sys.log(++client.discarded);
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
	    qos: (packet[0] & 0x06) >> 2, 
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
    this.server = net.createServer();
    var self = this;
    this.server.on('connection', function(socket) {
	sys.log("Connection from " + socket.remoteAddress);
	client = new MQTTClient(socket);
	self.emit('new_client', client);
    });
}
sys.inherits(MQTTServer, EventEmitter);

var s= new MQTTServer();
s.server.listen(1883, "::1");
