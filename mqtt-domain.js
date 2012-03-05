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
	    return { error: "length field too long" };
	}

	/* Reached the last length byte */
	if(!(client.buffer[i] & 0x80)) {
	    return { fixed:(1+i), remaining:length, total:(1+i+length) };
	}
    }
    return false;
}

module.exports= {
    VERSION: [0x00,0x06,0x4D,0x51,0x49,0x73,0x64,0x70,0x03],

    FixedHeader: function (messageType, dup, qos, retain) {
	return [0x00 | messageType*0x10 | dup*0x08 | qos*0x02 | retain];
    },
    
    MessageType: {
	CONNECT: 1,
	CONNACK: 2,
	PUBLISH: 3,
	PUBACK: 4,
	PUBREC: 5,
	PUBREL: 6,
	PUBCOMP: 7,
	SUBSCRIBE: 8,
	SUBACK: 9,
	UNSUBSCRIBE: 10,
	UNSUBACK: 11,
	PINGREQ: 12,
	PINGRESP: 13,
	DISCONNECT: 14
    },

    DUP: 0x08,
    QOS_0: 0x00,
    QOS_1: 0x02,
    QOS_2: 0x04,

    encode256: function(number) {
	return [number/256|0, number%256];
    },

    decode256: function(array) {
	if(toString.call([]) !== '[object Array]') { return }
	return array[0]*256+array[1];
    },

    encodeLength: function(length) {
	var remaining_length= length;
	var byte, remaining_bytes=[], remaining_count=0;
	do {
	    byte = remaining_length % 128;
	    remaining_length = remaining_length / 128;
	    /* If there are more digits to encode, set the top bit of this digit */
	    if(remaining_length > 0){
		byte = byte | 0x80;
	    }
	    remaining_bytes[remaining_count++] = byte;
	} while(remaining_length > 0 && remaining_count < 4);

	remaining_bytes.reverse();
	while(remaining_bytes[0]==128||remaining_bytes[0]==0) {
	    remaining_bytes.shift();
	}
	remaining_bytes[0] -= 128;
	remaining_bytes.reverse();

	return remaining_bytes;
    },

    chunker: function(buffer) {
	var data_count= buffer.length;
	var chunks= [];
	while(data_count > 0) {
	    var size= data_count > 65535 ? 65535 : data_count;
	    var chunk= new Buffer(size);
	    var at= buffer.length-data_count;
	    buffer.copy(chunk, 0, at, at+size);
	    chunks.push(chunk);
	    data_count -= size;
	}
	return chunks;
    },

    utf8StringBuffer: function(buffer) {
	var length= buffer.length;
	if(length > 256*256) {
	    throw("The buffer length exceeds 65535 bytes");
	}
	var utf8Buffer= new Buffer(length+2);
	utf8Buffer[0]= length/256|0;
	utf8Buffer[1]= length%256;
	buffer.copy(utf8Buffer, 2, 0);
	return utf8Buffer;
    },

    // This is an instance method
    parser: function(data) {
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
	    if(length.error) { 
		client.buffer= new Buffer(0);
		break;
	    }
	    
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
    },

    parseCommand: function(client, cmd, data) {
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
            'CONNACK': function() {
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
		var payload= getPayload();
		client.emit('publish', { messageId: messageId, topic: topic, payload: payload });
	    },
	    'PUBACK': function() {
	    },
	    'SUBACK': function() {
	    }
	})[cmd]();
    }
};